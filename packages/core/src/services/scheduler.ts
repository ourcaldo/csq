import cron from "node-cron";
import { z } from "zod";
import { InventorySource, Prisma } from "@prisma/client";
import prisma from "@csq/core/lib/db";
import {
  withSystemContext,
  withTenantContext,
} from "@csq/core/lib/tenant-context";
import { tenantActive } from "@csq/core/lib/tenant-status";
import { computeCostUsd } from "@csq/core/lib/llm-usage";
import { applyImport } from "@csq/core/lib/import-apply";
import { applyMapping } from "@csq/core/services/excel";
import { readSheet } from "@csq/core/services/sheets";
import { sheetsSourceConfigSchema } from "@csq/core/types/sheets";
import { getGoogleCreds } from "@csq/core/lib/google-connect";
import { replaceSourceRows } from "@csq/core/lib/source-rows";
import { startBaileysChannels, startBaileysHeartbeat, fetchContactAvatar } from "@csq/core/services/baileys";
import {
  registerScenarioEngine,
  resumePausedRuns,
  runScheduledTriggers,
} from "@csq/core/lib/scenario-engine";
import { sendAgentMessage } from "@csq/core/lib/agent-outbox";
import { getTemplateBody } from "@csq/core/lib/message-templates";
import { withSystemLock } from "@csq/core/lib/system-lock";
import { processCampaigns } from "@csq/core/lib/campaign-engine";
import { closeDueSnapshots } from "@csq/core/lib/kpi";
import { parseAutoCloseConfig } from "@csq/core/lib/auto-close";
import { logAction, toJsonValue } from "@csq/core/lib/audit";
import { overdueCutoff } from "@csq/core/lib/billing-overdue";

// In-process periodic sync for Google Sheets sources (PRD §23A - no Redis/queue,
// node-cron runs inside the Next.js server). Server-only: callers must invoke
// startScheduler() from a server context; it is a no-op on the client.

let started = false;

export function startScheduler(): void {
  if (started) return;
  if (typeof window !== "undefined") return; // never schedule on the client
  started = true;
  // Reconnect any already-CONNECTED Baileys channels (session keys persist in
  // the BaileysAuth table, so no re-scan unless logged out). Fire-and-forget.
  void startBaileysChannels().catch((err: unknown) => {
    console.error("[scheduler] Baileys boot reconnect failed:", err);
  });
  // Auto-reconnect Baileys sockets that get killed by the host proxy so
  // inbound messages don't silently drop.
  startBaileysHeartbeat();
  // Subscribe the scenario engine to the event bus (triggers). Idempotent -
  // safe to call on every health-check ping.
  registerScenarioEngine();
  // Every 5 minutes - bounds Sheets data freshness for the agent. The owner
  // can also force a refresh per source via "Sync Sekarang" on the Sumber Data
  // page (hits /api/import/sheets/sync, which reuses syncOne below). D10d: the
  // system lock makes the tick single-instance; the TTL (4 min) is shorter than
  // the cadence so a crashed tick self-heals before the next slot.
  cron.schedule("*/5 * * * *", () => {
    void withSystemLock("sheets-sync", 240, syncAllSheetsSources)
      .catch((err: unknown) => {
        // Errors are recorded per-source below; log only the top-level ones.
        console.error("[scheduler] sheets-sync tick threw:", err);
      });
  });
  // Every minute - resume scenario runs paused on a Wait node whose resumeAt
  // has passed, plus runs deferred at the concurrency cap; and evaluate the
  // scheduler-driven triggers (ON_SCHEDULE time match, ON_NO_REPLY silence
  // windows). Bounded per tick; remaining picked up next tick. Fire-and-forget,
  // per-run errors logged inside the engine. D10d: the whole minute tick is
  // one unit under the system lock (TTL 90s: tolerates a slow tick, self-heals
  // a crashed one).
  cron.schedule("* * * * *", () => {
    void withSystemLock("scenario-tick", 90, runScenarioTick)
      .catch((err: unknown) => {
        console.error("[scheduler] scenario tick threw:", err);
      });
    // Campaign engine (feature plan 2026-11-01): fires due campaigns, delivers
    // due per-recipient rows, closes finished runs. Same tick, its own lease -
    // the TTL (300s) sits far above a tick's worst case (≤50 bounded provider
    // calls), so a second instance can never start mid-tick (engine comment).
    void withSystemLock("campaign-tick", 300, processCampaigns)
      .catch((err: unknown) => {
        console.error("[scheduler] campaign tick threw:", err);
      });
  });
  // KPI snapshot close (PRD 17): daily at 00:10 Jakarta (17:10 UTC), plus a
  // boot catch-up so a worker that was down at the boundary still closes the
  // period on restart. closeDueSnapshots is idempotent (backfill walks only
  // missing periodKeys), so extra invocations are harmless. D10d: the lock
  // keeps a second instance from double-writing the same close.
  const kpiTick = (): void => {
    void withSystemLock("kpi-snapshots", 300, closeDueSnapshots)
      .then((r) => {
        if (r && r.written > 0) {
          console.log(
            `[scheduler] KPI snapshots: wrote ${r.written} across ${r.tenants} tenant(s)`
          );
        }
      })
      .catch((err: unknown) => {
        console.error("[scheduler] KPI snapshot tick threw:", err);
      });
  };
  cron.schedule("10 17 * * *", kpiTick);
  kpiTick();
  // PRD 33: daily USD/IDR rate for LLM cost conversion. open.er-api.com is a
  // free, keyless endpoint (verified live 2026-11-27, refreshes ~00:02 UTC);
  // the tick runs at 00:20 UTC plus a boot catch-up. Fail-soft: a failed
  // fetch leaves the latest existing rate in place (recordLlmUsage reuses it).
  const fxTick = (): void => {
    void withSystemLock("fx-rate-tick", 120, refreshFxRate)
      .then(() => undefined)
      .catch((err: unknown) => {
        console.error("[scheduler] FX rate tick threw:", err);
      });
  };
  cron.schedule("20 0 * * *", fxTick);
  fxTick();
  // PRD 33 amendment 2026-11-27: auto-sync model prices every 6 hours plus a
  // boot catch-up, so cost is known without any operator input and calls made
  // before a model's first price are backfilled within one tick.
  const priceTick = (): void => {
    void withSystemLock("llm-price-tick", 120, syncLlmPrices)
      .then(() => undefined)
      .catch((err: unknown) => {
        console.error("[scheduler] LLM price tick threw:", err);
      });
  };
  cron.schedule("40 */6 * * *", priceTick);
  priceTick();
  // PRD 27 avatar backfill: every 6 hours, bounded at 50 contacts per run
  // (WhatsApp rate-limit guard), for avatarless contacts on a Baileys
  // channel. New inbound messages fetch their avatar immediately; this
  // sweep covers the outbound-first backlog. The worker is the only
  // socket owner, so it only produces photos while it runs.
  cron.schedule("20 */6 * * *", () => {
    void withSystemLock("avatar-backfill", 600, backfillContactAvatars)
      .then((n) => {
        if (n && n > 0) console.log(`[scheduler] avatar backfill: stored ${n}`);
      })
      .catch((err: unknown) => {
        console.error("[scheduler] avatar backfill threw:", err);
      });
  });
  // PRD 14 amendment 2026-11-28: overdue downgrade tick. Daily at 01:00 UTC
  // plus a boot catch-up, under the billing-overdue-tick lock. A tenant whose
  // invoice is ISSUED and unpaid more than 7 days past due is downgraded to
  // the Free entitlements (planId stashed in overduePlanId, restored when no
  // invoice is overdue). Fail-soft per tenant.
  const billingTick = (): void => {
    void withSystemLock("billing-overdue-tick", 600, runBillingOverdueTick)
      .then((r) => {
        if (r && (r.downgraded > 0 || r.restored > 0)) {
          console.log(
            `[scheduler] billing overdue: ${r.downgraded} downgraded, ${r.restored} restored`
          );
        }
      })
      .catch((err: unknown) => {
        console.error("[scheduler] billing overdue tick threw:", err);
      });
  };
  cron.schedule("0 1 * * *", billingTick);
  billingTick();
}

const AVATAR_BACKFILL_BATCH = 50;

// PRD 33: daily USD/IDR rate (AUTO). The response shape is the documented
// open.er-api.com v6 payload: { result: "success", rates: { IDR: number } }.
const FX_RATE_URL = "https://open.er-api.com/v6/latest/USD";
const fxRateResponseSchema = z.object({
  result: z.literal("success"),
  rates: z.object({ IDR: z.number() }),
});

function utcDayStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

// Exactly one AUTO row per UTC day. `update: {}` is a no-op, so an existing
// row (AUTO or a MANUAL correction) is never overwritten.
async function refreshFxRate(): Promise<void> {
  const day = utcDayStart(new Date());
  const res = await fetch(FX_RATE_URL, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.error(
      `[scheduler] FX rate fetch failed: ${res.status} ${res.statusText}`
    );
    return;
  }
  const parsed = fxRateResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    console.error("[scheduler] FX rate response shape unexpected");
    return;
  }
  await prisma.fxRate.upsert({
    where: { date: day },
    update: {},
    create: {
      date: day,
      usdIdr: new Prisma.Decimal(String(parsed.data.rates.IDR)).toDecimalPlaces(2),
      source: "AUTO",
    },
  });
  console.log(
    `[scheduler] FX rate ${day.toISOString().slice(0, 10)}: 1 USD = ${parsed.data.rates.IDR} IDR`
  );
}

// PRD 33 amendment 2026-11-27 (owner direction): model prices are
// AUTO-SYNCED, never hand-entered. Source is the community-maintained LiteLLM
// catalog (USD per token for ~7k models), fetched daily and matched against
// the models this installation actually uses (usage rows + LLM env vars).
// Fail-soft: a failed fetch keeps the existing price rows.
const LLM_PRICE_CATALOG_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const catalogEntrySchema = z
  .object({
    input_cost_per_token: z.number().optional(),
    output_cost_per_token: z.number().optional(),
  })
  .passthrough();
const catalogSchema = z.record(z.string(), catalogEntrySchema);

type CatalogEntry = z.infer<typeof catalogEntrySchema>;

// Exact key first; otherwise the shortest provider-prefixed key that ends
// with "/<model>" (LiteLLM lists e.g. "gemini/gemini-2.5-flash" next to the
// plain key, plus azure/vertex variants with the same price).
function matchCatalogEntry(
  catalog: Record<string, CatalogEntry>,
  model: string
): CatalogEntry | null {
  if (catalog[model]) return catalog[model];
  const lower = model.toLowerCase();
  const candidates = Object.keys(catalog)
    .filter((k) => k.toLowerCase().endsWith(`/${lower}`))
    .sort((a, b) => a.split("/").length - b.split("/").length);
  return candidates.length > 0 ? catalog[candidates[0]] : null;
}

async function syncLlmPrices(): Promise<void> {
  const res = await fetch(LLM_PRICE_CATALOG_URL, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    console.error(
      `[scheduler] LLM price catalog fetch failed: ${res.status} ${res.statusText}`
    );
    return;
  }
  const parsed = catalogSchema.safeParse(await res.json());
  if (!parsed.success) {
    console.error("[scheduler] LLM price catalog shape unexpected");
    return;
  }
  const catalog = parsed.data;

  const used = new Set<string>();
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const rows = await prisma.llmUsage.findMany({
    where: { createdAt: { gte: since } },
    select: { model: true },
    distinct: ["model"],
  });
  for (const r of rows) used.add(r.model);
  for (const m of [
    process.env.LLM_CHAT_MODEL,
    process.env.LLM_SCENARIO_MODEL,
    process.env.LLM_EMBEDDING_MODEL,
  ]) {
    if (m) used.add(m);
  }
  used.add("gemini-decision-1");

  let synced = 0;
  for (const model of used) {
    const entry = matchCatalogEntry(catalog, model);
    if (!entry) continue;
    if (
      entry.input_cost_per_token === undefined &&
      entry.output_cost_per_token === undefined
    ) {
      continue;
    }
    const inputUsdPer1M = new Prisma.Decimal(
      String(entry.input_cost_per_token ?? 0)
    ).mul(1_000_000);
    const outputUsdPer1M = new Prisma.Decimal(
      String(entry.output_cost_per_token ?? 0)
    ).mul(1_000_000);
    await prisma.llmModelPrice.upsert({
      where: { model },
      create: {
        model,
        inputUsdPer1M,
        outputUsdPer1M,
        updatedById: "system",
      },
      update: { inputUsdPer1M, outputUsdPer1M, updatedById: "system" },
    });
    // Fill cost on rows recorded before this model had a price. Those rows
    // were UNKNOWN, not priced differently, so filling them is not a history
    // rewrite; each row keeps its own FX snapshot (costIdr stays null when
    // the row has none). Bounded per run - the next tick continues.
    const unpriced = await prisma.llmUsage.findMany({
      where: { model, costUsd: null },
      select: {
        id: true,
        promptTokens: true,
        completionTokens: true,
        fxRateIdrPerUsd: true,
      },
      take: 1000,
    });
    for (const u of unpriced) {
      const costUsd = computeCostUsd({
        promptTokens: u.promptTokens ?? undefined,
        completionTokens: u.completionTokens ?? undefined,
        inputUsdPer1M,
        outputUsdPer1M,
      });
      await prisma.llmUsage.update({
        where: { id: u.id },
        data: {
          costUsd,
          costIdr: u.fxRateIdrPerUsd
            ? costUsd.mul(u.fxRateIdrPerUsd).toDecimalPlaces(4)
            : null,
        },
      });
    }
    synced += 1;
  }
  console.log(`[scheduler] LLM prices synced for ${synced} model(s)`);
}

async function backfillContactAvatars(): Promise<number> {
  // Avatarless contacts whose latest conversation is on a connected
  // Baileys channel. Uses the conversation's channelId: the socket that
  // must fetch the photo belongs to that channel.
  const rows = await withSystemContext(async () =>
    prisma.contact.findMany({
      where: {
        avatarMediaId: null,
        conversations: {
          some: {
            channel: { provider: "BAILEYS", status: "CONNECTED" },
          },
        },
      },
      select: {
        id: true,
        tenantId: true,
        phone: true,
        conversations: {
          orderBy: { lastMessageAt: "desc" },
          take: 1,
          select: { channelId: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: AVATAR_BACKFILL_BATCH,
    })
  );
  let stored = 0;
  for (const row of rows) {
    const channelId = row.conversations[0]?.channelId;
    if (!channelId) continue;
    // Audit run-2 functional bug: these probes ran OUTSIDE any ALS context,
    // so under the fail-closed RLS policy they returned zero rows and the
    // whole sweep was a silent no-op. They now run inside the tenant context.
    // (fetchContactAvatar itself re-checks avatarMediaId, but the "after"
    // probe is what counts the stored result.)
    const result = await withTenantContext(row.tenantId, async () => {
      const before = await prisma.contact.findUnique({
        where: { id: row.id },
        select: { avatarMediaId: true },
      });
      if (!before || before.avatarMediaId) return false;
      await fetchContactAvatar({
        channelId,
        tenantId: row.tenantId,
        phone: row.phone,
      });
      const after = await prisma.contact.findUnique({
        where: { id: row.id },
        select: { avatarMediaId: true },
      });
      return !!after?.avatarMediaId;
    });
    if (result) stored += 1;
  }
  return stored;
}

// PRD 14 amendment 2026-11-28: downgrade tenants whose ISSUED invoices are
// more than 7 days past due, restore the stashed plan (Tenant.overduePlanId)
// once no invoice is overdue. Fail-soft per tenant: one bad tenant never
// blocks the rest, and the lock (billing-overdue-tick) serializes instances.
async function runBillingOverdueTick(): Promise<{
  downgraded: number;
  restored: number;
}> {
  const cutoff = overdueCutoff();

  const overdue = await withSystemContext(async () =>
    prisma.tenant.findMany({
      where: {
        planId: { not: null },
        overduePlanId: null,
        invoices: { some: { status: "ISSUED", dueAt: { lt: cutoff } } },
      },
      select: { id: true, planId: true },
    })
  );
  let downgraded = 0;
  for (const tenant of overdue) {
    const planId = tenant.planId;
    if (!planId) continue;
    try {
      const changed = await withTenantContext(tenant.id, async () => {
        const invoices = await prisma.invoice.findMany({
          where: { tenantId: tenant.id, status: "ISSUED", dueAt: { lt: cutoff } },
          select: { id: true },
        });
        const res = await prisma.tenant.updateMany({
          where: { id: tenant.id, planId, overduePlanId: null },
          data: { overduePlanId: planId, planId: null },
        });
        if (res.count !== 1) return false;
        await logAction({
          tenantId: tenant.id,
          agentId: null,
          action: "billing.overdue_downgrade",
          entityType: "Tenant",
          entityId: tenant.id,
          approvalStatus: "NONE",
          afterValue: toJsonValue({
            fromPlanId: planId,
            invoiceIds: invoices.map((i) => i.id),
          }),
        });
        return true;
      });
      if (changed) downgraded += 1;
    } catch (err: unknown) {
      console.error(
        `[scheduler] overdue downgrade failed for tenant ${tenant.id}:`,
        err
      );
    }
  }

  const restorable = await withSystemContext(async () =>
    prisma.tenant.findMany({
      where: {
        overduePlanId: { not: null },
        invoices: { none: { status: "ISSUED", dueAt: { lt: cutoff } } },
      },
      select: { id: true, overduePlanId: true },
    })
  );
  let restored = 0;
  for (const tenant of restorable) {
    const planId = tenant.overduePlanId;
    if (!planId) continue;
    try {
      const changed = await withTenantContext(tenant.id, async () => {
        const res = await prisma.tenant.updateMany({
          where: { id: tenant.id, overduePlanId: planId, planId: null },
          data: { planId, overduePlanId: null },
        });
        if (res.count !== 1) {
          // A plan was assigned manually during the downgrade: keep it, just
          // clear the stash so the tick stops considering this tenant.
          await prisma.tenant
            .updateMany({
              where: { id: tenant.id, overduePlanId: planId },
              data: { overduePlanId: null },
            })
            .catch(() => undefined);
          return false;
        }
        await logAction({
          tenantId: tenant.id,
          agentId: null,
          action: "billing.overdue_restored",
          entityType: "Tenant",
          entityId: tenant.id,
          approvalStatus: "NONE",
          afterValue: toJsonValue({ toPlanId: planId }),
        });
        return true;
      });
      if (changed) restored += 1;
    } catch (err: unknown) {
      console.error(
        `[scheduler] overdue restore failed for tenant ${tenant.id}:`,
        err
      );
    }
  }

  return { downgraded, restored };
}

// The once-a-minute scenario work, extracted so the system lock can wrap the
// whole tick as one unit.
async function runScenarioTick(): Promise<void> {
  await resumePausedRuns().catch((err: unknown) => {
    // Per-run errors are logged inside; swallow top-level failures.
    console.error("[scheduler] resumePausedRuns threw:", err);
  });
  await runScheduledTriggers().catch((err: unknown) => {
    console.error("[scheduler] runScheduledTriggers threw:", err);
  });
  await closeIdleSessions().catch((err: unknown) => {
    console.error("[scheduler] closeIdleSessions threw:", err);
  });
}

// Session-close: send the tenant's `session_end` template to conversations
// whose last message is the agent's reply and whose customer has been
// silent for the tenant's configured auto-close window. Free-form WhatsApp
// is allowed only inside Meta's 24h customer-service window (counted from
// the last INBOUND message); older threads are closed silently without a
// send. Sends are paced (per-tick cap + gap) so enabling the feature or
// draining a backlog never fans out as a burst. One message per
// conversation per window (tracked in Conversation.settings), skipped for
// RESOLVED or human-owned conversations, and only for tenants that enabled
// the auto-close setting (see the block below for the trigger semantics).
const conversationSettingsSchema = z.record(z.unknown());

// Auto session close (owner decision 2026-11-11, PRD 03 amendment): the
// trigger is the REVERSED one - close when the agent's reply is the last
// message and the customer has been silent for the tenant's configured
// window. An unanswered CUSTOMER message never auto-closes. Per-tenant
// setting in Tenant.settings.autoClose (default disabled); the status also
// flips to RESOLVED and the next inbound reopens the conversation.
const AUTO_CLOSE_MIN_IDLE_MINUTES = 15; // the schema's lower bound
const AUTO_CLOSE_SLACK_MS = 5 * 60 * 1000; // missed-tick tolerance
// Send pacing. The first sweep after a tenant enables this setting faces the
// whole backlog, and sending identical end-of-chat messages back to back is
// exactly the pattern WhatsApp flags as broadcast spam. Cap messages per
// tick and space them out; the remainder is picked up on the next minutes.
const AUTO_CLOSE_MAX_SENDS_PER_TICK = 5;
const AUTO_CLOSE_SEND_GAP_MS = 4000;
// Free-form text is only allowed inside Meta's 24h customer-service window,
// counted from the last INBOUND (customer) message. Outside it there is no
// legitimate way to deliver the close message: close silently instead of
// firing at stale threads.
const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

async function closeIdleSessions(): Promise<void> {
  // Coarse pre-filter at the MINIMUM configurable idle (+ slack); the exact
  // per-tenant window is checked below. The JSON path filter means only
  // tenants that enabled the feature are even scanned.
  const minCutoff = new Date(
    Date.now() - (AUTO_CLOSE_MIN_IDLE_MINUTES * 60 * 1000 + AUTO_CLOSE_SLACK_MS)
  );

  const conversations = await withSystemContext(async () =>
    prisma.conversation.findMany({
      where: {
        status: "OPEN",
        assigneeUserId: null, // human-owned: do not auto-close
        lastMessageAt: { lt: minCutoff },
        tenant: {
          status: "ACTIVE",
          settings: { path: ["autoClose", "enabled"], equals: true },
        },
      },
      orderBy: { lastMessageAt: "asc" },
      take: 20,
      include: {
        channel: true,
        tenant: { select: { settings: true } },
      },
    })
  );

  let sends = 0;
  for (const conversation of conversations) {
    if (sends >= AUTO_CLOSE_MAX_SENDS_PER_TICK) break;
    try {
      // RLS context + suspension guard (PRD 16 SEC-1/SEC-4).
      await withTenantContext(conversation.tenantId, async () => {
        const cfg = parseAutoCloseConfig(conversation.tenant.settings);
        if (!cfg.enabled) return;
        const cutoff = new Date(
          Date.now() - (cfg.idleMinutes * 60 * 1000 + AUTO_CLOSE_SLACK_MS)
        );

        // The agent must have the last word: close ONLY when the last
        // message is the agent's reply and the customer never answered it.
        // An unanswered customer message is a gap for staff, not a closure
        // (owner decision 2026-11-11).
        const last = await prisma.message.findFirst({
          where: { conversationId: conversation.id },
          orderBy: { createdAt: "desc" },
        });
        if (!last || last.direction !== "OUTBOUND") return;
        if (last.createdAt > cutoff) return;

        // Already closed for this window?
        const rawSettings = conversationSettingsSchema.safeParse(
          conversation.settings ?? {}
        );
        const settings = rawSettings.success ? rawSettings.data : {};
        if (settings.lastAutoClosedMessageId === last.id) return;

        const markResolved = () =>
          prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              // "Closed the chat" means the status too: leaves the inbox's
              // active filter. The next inbound flips it back to OPEN
              // (inbox.ts findOrCreateConversation).
              status: "RESOLVED",
              settings: {
                ...settings,
                sessionClosedAt: new Date().toISOString(),
                lastAutoClosedMessageId: last.id,
              },
            },
          });

        // Outside Meta's 24h customer-service window (no inbound, or the
        // last customer message is older than 24h) a free-form close message
        // cannot be delivered. Close silently: no message goes out at all.
        const lastInbound = await prisma.message.findFirst({
          where: { conversationId: conversation.id, direction: "INBOUND" },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        });
        if (
          !lastInbound ||
          Date.now() - lastInbound.createdAt.getTime() > CUSTOMER_SERVICE_WINDOW_MS
        ) {
          await markResolved();
          return;
        }

        if (conversation.channel.status !== "CONNECTED") return;
        if (sends >= AUTO_CLOSE_MAX_SENDS_PER_TICK) return;

        const body = await getTemplateBody(
          conversation.tenantId,
          "session_end",
          "Terima kasih sudah mengobrol dengan kami! Jika ada pertanyaan lain, silakan chat kembali ya. 😊"
        );
        if (!body) return;

        if (sends > 0) {
          await new Promise((r) => setTimeout(r, AUTO_CLOSE_SEND_GAP_MS));
        }
        await sendAgentMessage({
          channel: conversation.channel,
          conversationId: conversation.id,
          customerPhone: conversation.customerPhone,
          body,
          agentId: null,
          action: "conversation.session_closed",
        });
        sends += 1;

        await markResolved();
      });
    } catch (err) {
      console.error(
        `[scheduler] session-close failed for conversation ${conversation.id}: ${err instanceof Error ? err.message : err}`
      );
    }
  }
}

async function syncAllSheetsSources(): Promise<void> {
  // Sync ACTIVE sources, and retry ERROR sources so a transient failure (e.g. a
  // deploy that hit the old mapping:null parse bug, or a one-off Google API
  // hiccup) self-heals on the next tick instead of forcing the owner to
  // delete + re-add. syncOne flips status back to ACTIVE on success; on failure
  // it stays ERROR. Mirrors the Baileys startup-reconnect pattern.
  const sources = await withSystemContext(async () =>
    prisma.dataSource.findMany({
      where: { type: "GOOGLE_SHEETS", status: { in: ["ACTIVE", "ERROR"] } },
    })
  );
  for (const source of sources) {
    try {
      // RLS context (PRD 16 SEC-1): the sync writes this tenant's data.
      await withTenantContext(source.tenantId, () =>
        syncOne(source.id, source.tenantId, source.config)
      );
    } catch {
      await withSystemContext(async () => {
        await prisma.dataSource
          .update({ where: { id: source.id }, data: { status: "ERROR" } })
          .catch(() => undefined);
      });
    }
  }
}

// Exported so the manual sync route (/api/import/sheets/sync) can reuse the
// exact same logic and error handling.
export async function syncOne(
  sourceId: string,
  tenantId: string,
  rawConfig: unknown
): Promise<{ created: number; updated: number; errors: string[] }> {
  // Parse the Json config with Zod - never `as`. A corrupt config throws and
  // is surfaced by the caller as a sync error (DataSource.status = ERROR).
  const config = sheetsSourceConfigSchema.parse(rawConfig);
  const dataType = (config.dataType ?? "produk").trim().toLowerCase();
  const isProduct = dataType === "produk";
  // OAuth credentials live on the tenant now (lib/google-connect), not in the
  // source config. No creds => treat as a sync error (caller marks ERROR).
  const creds = await getGoogleCreds(tenantId);
  if (!creds) {
    throw new Error("Google account not connected");
  }
  const range = config.range || config.sheetName;
  const sheet = await readSheet(creds, config.spreadsheetId, range);

  // Only "produk" sources get structured product/inventory import. Other types
  // (cabang, staff, ...) are reference data - just refresh the stored rows.
  let summary: { created: number; updated: number; errors: string[] };
  if (isProduct && config.mapping) {
    const products = applyMapping(sheet.rows, config.mapping);
    summary = await applyImport(
      tenantId,
      products,
      InventorySource.GOOGLE_SHEETS,
      config.spreadsheetId
    );
  } else {
    summary = { created: 0, updated: 0, errors: [] };
  }

  await prisma.dataSource.update({
    where: { id: sourceId },
    data: { lastSyncAt: new Date(), status: "ACTIVE" },
  });

  // Refresh the full stored rows so source.search sees the latest sheet content.
  await replaceSourceRows(tenantId, sourceId, sheet.rows);

  return summary;
}
