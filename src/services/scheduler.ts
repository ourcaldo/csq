import cron from "node-cron";
import { z } from "zod";
import { InventorySource } from "@prisma/client";
import prisma from "@/lib/db";
import { applyImport } from "@/lib/import-apply";
import { applyMapping } from "@/services/excel";
import { readSheet } from "@/services/sheets";
import { sheetsSourceConfigSchema } from "@/types/sheets";
import { getGoogleCreds } from "@/lib/google-connect";
import { replaceSourceRows } from "@/lib/source-rows";
import { startBaileysChannels, startBaileysHeartbeat } from "@/services/baileys";
import {
  registerScenarioEngine,
  resumePausedRuns,
  runScheduledTriggers,
} from "@/lib/scenario-engine";
import { sendAgentMessage } from "@/lib/agent-outbox";
import { getTemplateBody } from "@/lib/message-templates";
import { withSystemLock } from "@/lib/system-lock";
import { processCampaigns } from "@/lib/campaign-engine";

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
// whose last inbound is past the 1h agent-session TTL. Free-form WhatsApp is
// allowed here (1h idle = still inside Meta's 24h customer-service window),
// so no Meta template approval is needed. One message per conversation per
// window (tracked in Conversation.settings), skipped for RESOLVED or
// human-owned conversations.
const conversationSettingsSchema = z.record(z.unknown());
const SESSION_TTL_MS = 60 * 60 * 1000; // matches agent-loop's window TTL

async function closeIdleSessions(): Promise<void> {
  // 5-minute slack so a missed tick (e.g. mid-deploy) still closes the window.
  const cutoff = new Date(Date.now() - (SESSION_TTL_MS + 5 * 60 * 1000));

  const conversations = await prisma.conversation.findMany({
    where: {
      status: "OPEN",
      assigneeUserId: null, // human-owned: do not auto-close
      lastMessageAt: { lt: cutoff },
    },
    orderBy: { lastMessageAt: "asc" },
    take: 20,
    include: { channel: true },
  });

  for (const conversation of conversations) {
    try {
      // Only close on the customer's last inbound (outbound activity alone
      // must not trigger a close - session TTL counts from customer input).
      const last = await prisma.message.findFirst({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: "desc" },
      });
      if (!last || last.direction !== "INBOUND") continue;
      if (last.createdAt > cutoff) continue;

      // Already closed for this window?
      const rawSettings = conversationSettingsSchema.safeParse(
        conversation.settings ?? {}
      );
      const settings = rawSettings.success ? rawSettings.data : {};
      if (settings.lastInboundClosedAt === last.id) continue;

      if (conversation.channel.status !== "CONNECTED") continue;

      const body = await getTemplateBody(
        conversation.tenantId,
        "session_end",
        "Terima kasih sudah mengobrol dengan kami! Jika ada pertanyaan lain, silakan chat kembali ya. 😊"
      );
      if (!body) continue;

      await sendAgentMessage({
        channel: conversation.channel,
        conversationId: conversation.id,
        customerPhone: conversation.customerPhone,
        body,
        agentId: null,
        action: "conversation.session_closed",
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          settings: {
            ...settings,
            sessionClosedAt: new Date().toISOString(),
            lastInboundClosedAt: last.id,
          },
        },
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
  const sources = await prisma.dataSource.findMany({
    where: { type: "GOOGLE_SHEETS", status: { in: ["ACTIVE", "ERROR"] } },
  });
  for (const source of sources) {
    try {
      await syncOne(source.id, source.tenantId, source.config);
    } catch {
      await prisma.dataSource
        .update({ where: { id: source.id }, data: { status: "ERROR" } })
        .catch(() => undefined);
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
