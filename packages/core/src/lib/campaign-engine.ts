import type { Campaign, MediaAsset } from "@prisma/client";
import prisma from "@csq/core/lib/db";
import {
  withSystemContext,
  withTenantContext,
} from "@csq/core/lib/tenant-context";
import { tenantActive } from "@csq/core/lib/tenant-status";
import { findOrCreateConversation, CLOUD_API_WINDOW_MS } from "@csq/core/lib/inbox";
import { getProvider } from "@csq/core/lib/whatsapp-provider";
import { logAction } from "@csq/core/lib/audit";
import { getTenantEntitlements } from "@csq/core/lib/entitlements";
import {
  nextCampaignOccurrence,
  nextIntervalOccurrence,
  scheduleTz,
  type ScheduleConfig,
} from "@csq/core/lib/campaign-schedule";

// Campaign engine (feature plan 2026-11-01, section 3.5). Called every minute
// by the scheduler under withSystemLock("campaign-tick", 300, ...) - the same
// crash-safe pattern the scenario engine uses: all state lives in rows
// (CampaignRun + CampaignMessage.scheduledFor), never in memory.
//
// Concurrency: the system lock serializes ticks across instances. The lock TTL
// (300s) is deliberately far above a tick's worst case (SEND_PER_TICK sends,
// each a bounded provider call), so no second instance can start while a tick
// is in flight. COR-1 (PRD 16): each row is claimed atomically
// (PENDING -> SENDING via updateMany) BEFORE the provider call, and stale
// SENDING rows are reset to PENDING at tick start - the only surviving
// duplicate window is a crash between the provider send and the SENT mark,
// the accepted edge of at-least-once delivery.

const FIRE_CAMPAIGNS_PER_TICK = 5;
const SEND_PER_TICK = 50;
const CLOSE_RUNS_PER_TICK = 20;
// Safety net, never a silent drop: a fire whose audience exceeds this creates
// a truncated run plus an audit row. UMKM contact lists sit far below it.
const MAX_RECIPIENTS_PER_FIRE = 5000;

// The public base URL for media links - the API service (PRD 23C Phase 7:
// media serving moved to apps/api, so links must point at its domain, not
// the dashboard's). The Cloud API needs an HTTPS link Meta can fetch (plan
// section 3.2.1).
function publicMediaUrl(assetId: string): string {
  const base = (process.env.API_URL ?? "").replace(/\/$/, "");
  if (!base) throw new Error("API_URL is not set - cannot build the public media link");
  return `${base}/api/media/${assetId}`;
}

export async function processCampaigns(): Promise<void> {
  // COR-1 (PRD 16): a SENDING row at tick start is from a crashed tick (the
  // lock serializes ticks; a live tick never leaves one behind). Reset it so
  // delivery resumes; the atomic claim below prevents any concurrent claim.
  await withSystemContext(async () =>
    prisma.campaignMessage.updateMany({
      where: { status: "SENDING" },
      data: { status: "PENDING" },
    })
  );
  await fireDueCampaigns();
  await deliverDueCampaignMessages();
  await closeFinishedRuns();
}

// ─────────────────────────── Fire ───────────────────────────

async function fireDueCampaigns(): Promise<void> {
  const due = await withSystemContext(async () =>
    prisma.campaign.findMany({
      where: { status: "ACTIVE", nextRunAt: { lte: new Date() } },
      take: FIRE_CAMPAIGNS_PER_TICK,
      orderBy: { nextRunAt: "asc" },
    })
  );
  for (const campaign of due) {
    await withTenantContext(campaign.tenantId, () =>
      fireCampaign(campaign)
    ).catch((err: unknown) => {
      console.error(`[campaign] fire failed for ${campaign.id}:`, err);
    });
  }
}

async function fireCampaign(campaign: Campaign): Promise<void> {
  // SEC-4 (PRD 16): a suspended tenant's campaigns do not fire. Marked with
  // autoPaused so tenant activation resumes exactly these.
  if (!(await tenantActive(campaign.tenantId))) {
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "PAUSED", autoPaused: true },
    });
    await logAction({
      tenantId: campaign.tenantId,
      agentId: null,
      action: "campaign.paused_suspension",
      entityType: "Campaign",
      entityId: campaign.id,
      approvalStatus: "NONE",
      afterValue: { reason: "Tenant dinonaktifkan." },
    });
    return;
  }

  // Plan gate (PRD 13): downgraded tenants must not keep firing. Pausing is
  // deliberate - the campaign stays visible and can be reactivated after an
  // upgrade. In-flight CampaignMessage rows still drain (bounded work).
  const entitlements = await getTenantEntitlements(campaign.tenantId);
  if (!entitlements.features.includes("campaigns")) {
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "PAUSED" },
    });
    await logAction({
      tenantId: campaign.tenantId,
      agentId: null,
      action: "campaign.paused_plan",
      entityType: "Campaign",
      entityId: campaign.id,
      approvalStatus: "NONE",
      afterValue: { reason: "Fitur kampanye tidak aktif di paket tenant." },
    });
    return;
  }

  const now = new Date();
  const tz = scheduleTz();
  const config = campaign.scheduleConfig as ScheduleConfig;

  // Resolve the audience for THIS fire (round-1 decision: ALL/CATEGORY/TAGS
  // resolve fresh; MANUAL is the stored snapshot).
  const recipients = await resolveAudience(campaign);
  const truncated = recipients.length > MAX_RECIPIENTS_PER_FIRE;

  const run = await prisma.campaignRun.create({
    data: { tenantId: campaign.tenantId, campaignId: campaign.id },
  });

  if (recipients.length > 0) {
    const rows = (truncated ? recipients.slice(0, MAX_RECIPIENTS_PER_FIRE) : recipients).map(
      (contact, i) => ({
        tenantId: campaign.tenantId,
        runId: run.id,
        contactId: contact.id,
        phone: contact.phone,
        scheduledFor: new Date(now.getTime() + i * campaign.delaySeconds * 1000),
      })
    );
    await prisma.campaignMessage.createMany({ data: rows });
  }

  // Stamp the fire and compute the next slot. ONCE campaigns complete at
  // fire time; their pending rows still drain (deliveries key off the rows,
  // and COMPLETED ≠ PAUSED in the pause check).
  let next: Date | null;
  if (campaign.scheduleKind === "ONCE") {
    next = null;
  } else if (campaign.scheduleKind === "INTERVAL") {
    next = nextIntervalOccurrence(now, config.everyDays ?? 1, tz);
  } else {
    next = nextCampaignOccurrence(campaign.scheduleKind, config, now, tz);
  }
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      lastRunAt: now,
      nextRunAt: next,
      status: campaign.scheduleKind === "ONCE" ? "COMPLETED" : "ACTIVE",
    },
  });

  await logAction({
    tenantId: campaign.tenantId,
    agentId: null,
    action: "campaign.fire",
    entityType: "CampaignRun",
    entityId: run.id,
    approvalStatus: "NONE",
    afterValue: {
      campaign: campaign.name,
      recipients: Math.min(recipients.length, MAX_RECIPIENTS_PER_FIRE),
      totalAudience: recipients.length,
      truncated,
    },
  });
}

async function resolveAudience(campaign: Campaign) {
  const where =
    campaign.audience === "ALL"
      ? { tenantId: campaign.tenantId }
      : campaign.audience === "CATEGORY"
        ? { tenantId: campaign.tenantId, categories: { some: { categoryId: { in: campaign.categoryIds } } } }
        : campaign.audience === "TAGS"
          ? { tenantId: campaign.tenantId, tags: { some: { tagId: { in: campaign.tagIds } } } }
          : { tenantId: campaign.tenantId, id: { in: campaign.contactIds } };
  return prisma.contact.findMany({
    where,
    select: { id: true, phone: true },
    orderBy: { createdAt: "asc" },
  });
}

// ─────────────────────────── Deliver ───────────────────────────

async function deliverDueCampaignMessages(): Promise<void> {
  const due = await withSystemContext(async () =>
    prisma.campaignMessage.findMany({
      where: { status: "PENDING", scheduledFor: { lte: new Date() } },
      orderBy: { scheduledFor: "asc" },
      take: SEND_PER_TICK,
      include: { run: { include: { campaign: true } } },
    })
  );

  // Media bytes are loaded once per asset per tick (a blast reuses the same
  // images; 5 MB × 50 recipients must not become 50 reads).
  const assetCache = new Map<string, MediaAsset | null>();
  async function asset(id: string): Promise<MediaAsset | null> {
    if (!assetCache.has(id)) {
      const found = await prisma.mediaAsset
        .findUnique({ where: { id } })
        .catch(() => null);
      assetCache.set(id, found);
    }
    return assetCache.get(id) ?? null;
  }

  for (const row of due) {
    await withTenantContext(row.tenantId, () =>
      deliverOne(row, asset)
    ).catch((err: unknown) => {
      console.error(`[campaign] deliver failed for ${row.id}:`, err);
    });
  }
}

async function deliverOne(
  row: {
    id: string;
    tenantId: string;
    runId: string;
    phone: string;
  },
  asset: (id: string) => Promise<MediaAsset | null>
): Promise<void> {
  // COR-1 (PRD 16): atomic claim before any provider call. If the claim
  // affects zero rows, another tick instance already owns this row.
  const claimed = await prisma.campaignMessage.updateMany({
    where: { id: row.id, status: "PENDING" },
    data: { status: "SENDING" },
  });
  if (claimed.count !== 1) return;

  // SEC-4 (PRD 16): suspended tenants send nothing. The row stays SENDING
  // for this tick and is reset to PENDING by the next tick's stale sweep -
  // delivery resumes on activation, nothing is dropped.
  if (!(await tenantActive(row.tenantId))) return;

  const run = await prisma.campaignRun.findUniqueOrThrow({
    where: { id: row.runId },
    include: { campaign: true },
  });
  const campaign = run.campaign;

  // Pause semantics: PAUSED stops future fires AND holds in-flight PENDING
  // rows (they resume on activate) - nothing is deleted.
  if (campaign.status === "PAUSED") return;

  // Resolve the channel fresh - a disconnected or deleted channel fails this
  // recipient with a reason, never the whole tick.
  const channel = await prisma.channel.findUnique({ where: { id: campaign.channelId } });
  if (!channel || channel.status !== "CONNECTED") {
    await mark(row.id, "FAILED", "channel_missing_or_disconnected");
    return;
  }
  const provider = getProvider(channel);

  // The conversation for (channel, phone) - replies land in the shared inbox.
  const { conversation } = await findOrCreateConversation(
    row.tenantId,
    channel.id,
    row.phone
  );

  try {
    if (campaign.sendKind === "META_TEMPLATE" && channel.provider === "CLOUD_API") {
      // Decision 2.11: the only content that reaches out-of-window recipients
      // on the official channel. Meta-template campaigns on Baileys send the
      // snapshot body instead (the provider's sendTemplate would send the
      // template NAME as text).
      const result = await provider.sendTemplate({
        to: row.phone,
        templateName: campaign.metaName ?? "",
        languageCode: campaign.metaLanguage ?? "id",
      });
      await recordOutbound({
        tenantId: row.tenantId,
        conversationId: conversation.id,
        body: campaign.body,
        waMessageId: result.waMessageId,
      });
      await mark(row.id, "SENT", undefined, result.waMessageId);
      return;
    }

    if (campaign.sendKind === "BODY" && channel.provider === "CLOUD_API") {
      // Free-form on the official channel: only inside the 24h window.
      const lastInbound = await prisma.message.findFirst({
        where: { conversationId: conversation.id, direction: "INBOUND" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      const withinWindow =
        !!lastInbound &&
        Date.now() - lastInbound.createdAt.getTime() <= CLOUD_API_WINDOW_MS;
      if (!withinWindow) {
        await mark(row.id, "SKIPPED", "window_closed_24h");
        return;
      }
    }

    // Free-form burst: text message first, then each image as its own media
    // message (plan 3.2.1). The pacing delay applies between contacts, not
    // within a burst. Delivery order within a burst is best-effort - WhatsApp
    // does not guarantee it (documented platform behavior).
    const burstIds: Array<string | undefined> = [];
    if (campaign.body.trim().length > 0) {
      const result = await provider.sendText({ to: row.phone, body: campaign.body });
      await recordOutbound({
        tenantId: row.tenantId,
        conversationId: conversation.id,
        body: campaign.body,
        waMessageId: result.waMessageId,
      });
      burstIds.push(result.waMessageId);
    }
    for (const imageId of campaign.imageIds) {
      const media = await asset(imageId);
      if (!media) {
        throw new Error(`Image asset not found: ${imageId}`);
      }
      const result = await provider.sendImage({
        to: row.phone,
        link: publicMediaUrl(imageId),
        bytes: Buffer.from(media.data),
        mimeType: media.mimeType,
      });
      await recordOutbound({
        tenantId: row.tenantId,
        conversationId: conversation.id,
        body: `[image ${media.id.slice(0, 8)}]`,
        waMessageId: result.waMessageId,
      });
      burstIds.push(result.waMessageId);
    }
    await mark(row.id, "SENT", undefined, burstIds[0]);
  } catch (err) {
    const reason = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await mark(row.id, "FAILED", reason);
  }
}

async function mark(
  id: string,
  status: "SENT" | "FAILED" | "SKIPPED",
  reason?: string,
  waMessageId?: string
): Promise<void> {
  await prisma.campaignMessage.update({
    where: { id },
    data: {
      status,
      reason: reason ?? null,
      waMessageId: waMessageId ?? null,
      ...(status === "SENT" ? { sentAt: new Date() } : {}),
    },
  });
}

// One OUTBOUND Message row per burst item, attributed to the campaign. Like
// scenario sends, these deliberately do NOT count as "answered" for the agent
// drain (decision 2.4): a blast never suppresses the AI replying to a
// customer's pending question. Per-recipient attribution lives on the
// CampaignMessage row, so the Message row itself carries only the content.
async function recordOutbound(args: {
  tenantId: string;
  conversationId: string;
  body: string;
  waMessageId?: string;
}): Promise<void> {
  await prisma.message.create({
    data: {
      tenantId: args.tenantId,
      conversationId: args.conversationId,
      direction: "OUTBOUND",
      senderType: "CAMPAIGN",
      body: args.body,
      waMessageId: args.waMessageId,
      kind: "TEXT",
    },
  });
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { lastMessageAt: new Date() },
  });
}

// ─────────────────────────── Close runs ───────────────────────────

async function closeFinishedRuns(): Promise<void> {
  // Runs with zero remaining PENDING or SENDING rows (including
  // zero-recipient fires). A claimed-but-unsent row must never close its run.
  const stale = await withSystemContext(async () =>
    prisma.campaignRun.findMany({
      where: {
        finishedAt: null,
        messages: { none: { status: { in: ["PENDING", "SENDING"] } } },
      },
      take: CLOSE_RUNS_PER_TICK,
    })
  );
  for (const run of stale) {
    await withTenantContext(run.tenantId, async () => {
      const grouped = await prisma.campaignMessage.groupBy({
        by: ["status"],
        where: { runId: run.id },
        _count: { _all: true },
      });
      const counts = {
        total: grouped.reduce((sum, g) => sum + g._count._all, 0),
        sent: grouped.find((g) => g.status === "SENT")?._count._all ?? 0,
        failed: grouped.find((g) => g.status === "FAILED")?._count._all ?? 0,
        skipped: grouped.find((g) => g.status === "SKIPPED")?._count._all ?? 0,
      };
      await prisma.campaignRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), counts },
      });
    });
  }
}
