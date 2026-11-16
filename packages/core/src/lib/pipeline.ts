import { Prisma, StageKind } from "@prisma/client";
import prisma from "@csq/core/lib/db";
import { logAction } from "@csq/core/lib/audit";
import { HttpError } from "@csq/core/lib/queries";

// Pipeline / deal-stage core logic (SDD §4.4 pattern). One pipeline per tenant,
// lazily seeded from the default template. The AI agent and humans both move a
// conversation's deal via setConversationStage; every move is audited and recorded
// in DealStageHistory. Server-only.

export type PipelineWithStages = Prisma.PipelineGetPayload<{
  include: { stages: true };
}>;

// A deal joined with its stage + conversation (contact, assignee, channel,
// tags, last message) for the kanban board (pipeline revamp 2026-11-16).
export type DealWithRelations = Prisma.DealGetPayload<{
  include: {
    stage: true;
    conversation: {
      include: {
        contact: true;
        assignee: true;
        channel: { select: { id: true; provider: true } };
        tags: { include: { tag: true } };
        messages: {
          take: 1;
          orderBy: { createdAt: "desc" };
          select: { body: true; senderType: true; kind: true };
        };
      };
    };
  };
}>;

// Default pipeline template - copied per tenant on first Pipeline-page open.
// Mapped onto the existing order flow: Pesanan ↔ order.create, Menang ↔
// confirmed order. winProbability/expectedDays are optional metadata the owner
// can clear; they power the funnel/stuck-deal views.
type DefaultStage = {
  name: string;
  order: number;
  winProbability: number;
  expectedDays: number | null;
  kind: StageKind;
};

export const DEFAULT_PIPELINE_NAME = "Pipeline Penjualan";

const DEFAULT_STAGES: DefaultStage[] = [
  { name: "Baru", order: 1, winProbability: 0.1, expectedDays: 3, kind: "OPENING" },
  { name: "Tertarik", order: 2, winProbability: 0.25, expectedDays: 7, kind: "NORMAL" },
  { name: "Penawaran", order: 3, winProbability: 0.5, expectedDays: 7, kind: "NORMAL" },
  { name: "Pesanan", order: 4, winProbability: 0.75, expectedDays: 3, kind: "NORMAL" },
  { name: "Menang", order: 5, winProbability: 1, expectedDays: null, kind: "WON" },
  { name: "Kalah", order: 6, winProbability: 0, expectedDays: null, kind: "LOST" },
];

// Lazy-seed the tenant's pipeline from the default template if it doesn't exist.
// D10b: a database unique on Pipeline.tenantId makes this a real upsert - two
// concurrent callers can no longer both pass the "not exists" check and seed
// two pipelines; the loser's create turns into a no-op update.
export async function getOrCreatePipeline(
  tenantId: string
): Promise<PipelineWithStages> {
  return prisma.pipeline.upsert({
    where: { tenantId },
    create: {
      tenantId,
      name: DEFAULT_PIPELINE_NAME,
      stages: {
        create: DEFAULT_STAGES.map((s) => ({ tenantId, ...s })),
      },
    },
    update: {},
    include: { stages: { orderBy: { order: "asc" } } },
  });
}

// Resolve a stage by name within the tenant's pipeline (case-insensitive).
export async function findStageByName(
  tenantId: string,
  stageName: string
): Promise<PipelineWithStages> {
  const pipeline = await getOrCreatePipeline(tenantId);
  const stage = pipeline.stages.find(
    (s) => s.name.toLowerCase() === stageName.trim().toLowerCase()
  );
  if (!stage) {
    throw new HttpError("NOT_FOUND", `Tahap "${stageName}" tidak ditemukan.`);
  }
  return pipeline;
}

// Place (or move) a conversation's deal on a stage. Used by the AI tool and the
// dashboard PATCH. Creates the Deal lazily on first placement, writes a
// DealStageHistory row on every real transition, and audits. Terminal stages
// (WON/LOST) can't be moved out of.
export async function setConversationStage(args: {
  tenantId: string;
  conversationId: string;
  stageName: string;
  movedByUserId?: string;
  movedByAgentId?: string;
  reason?: string;
}): Promise<{ dealId: string; stageId: string }> {
  const { tenantId, conversationId, stageName, movedByUserId, movedByAgentId, reason } = args;
  const pipeline = await findStageByName(tenantId, stageName);
  const stage = pipeline.stages.find(
    (s) => s.name.toLowerCase() === stageName.trim().toLowerCase()
  );
  // findStageByName throws if not found; stage is defined here.
  if (!stage) throw new HttpError("NOT_FOUND", "Tahap tidak ditemukan.");

  const existing = await prisma.deal.findUnique({
    where: { conversationId },
  });
  if (existing && existing.tenantId !== tenantId) {
    throw new HttpError("NOT_FOUND", "Deal tidak ditemukan untuk tenant ini.");
  }
  const fromStage = existing
    ? pipeline.stages.find((s) => s.id === existing.stageId) ?? null
    : null;

  // Terminal stages can't be moved out of.
  if (fromStage && (fromStage.kind === "WON" || fromStage.kind === "LOST")) {
    throw new HttpError(
      "VALIDATION_ERROR",
      `Tahap "${fromStage.name}" adalah tahap akhir (Menang/Kalah); tidak bisa dipindahkan keluar.`
    );
  }

  const deal = existing
    ? await prisma.deal.update({
        where: { id: existing.id },
        data: { stageId: stage.id },
      })
    : await prisma.deal.create({
        data: { tenantId, conversationId, stageId: stage.id },
      });

  // Record a history row + audit only on a real transition.
  if (!existing || existing.stageId !== stage.id) {
    await prisma.dealStageHistory.create({
      data: {
        tenantId,
        dealId: deal.id,
        fromStageId: existing?.stageId ?? stage.id,
        toStageId: stage.id,
        movedByUserId,
        movedByAgentId,
        reason,
      },
    });
    await logAction({
      tenantId,
      agentId: movedByAgentId ?? null,
      action: "deal.stage_change",
      entityType: "Deal",
      entityId: deal.id,
      beforeValue: { stage: fromStage?.name ?? "(belum)" },
      afterValue: { stage: stage.name },
      approvalStatus: "NONE",
    });
  }

  return { dealId: deal.id, stageId: stage.id };
}

// Every new conversation is a new lead, so it belongs on the pipeline's first
// stage immediately (owner report 2026-11-16: an API send created the chat but
// nothing appeared in the Pipeline). Deals used to exist only after the AI or
// a human moved a card, so an outbound-only conversation (API send, campaign,
// scenario) never showed up. Idempotent: setConversationStage no-ops when the
// deal is already on that stage.
export async function ensureInitialDeal(args: {
  tenantId: string;
  conversationId: string;
}): Promise<void> {
  const pipeline = await getOrCreatePipeline(args.tenantId);
  const first =
    pipeline.stages.find((s) => s.kind === "OPENING") ?? pipeline.stages[0];
  if (!first) return;
  await setConversationStage({
    tenantId: args.tenantId,
    conversationId: args.conversationId,
    stageName: first.name,
    reason: "conversation.created",
  });
}

// Set (or correct) the estimated deal value. The deal normally already exists
// (created with the conversation); if it does not, place it on the first stage
// rather than failing. Audited when the value actually changes.
export async function setDealValue(args: {
  tenantId: string;
  conversationId: string;
  value: number;
  movedByUserId?: string;
}): Promise<{ dealId: string; value: number }> {
  if (!Number.isInteger(args.value) || args.value < 0 || args.value > 1_000_000_000_000) {
    throw new HttpError("VALIDATION_ERROR", "Nilai deal tidak valid.");
  }
  const conversation = await prisma.conversation.findFirst({
    where: { id: args.conversationId, tenantId: args.tenantId },
    select: { id: true },
  });
  if (!conversation) {
    throw new HttpError("NOT_FOUND", "Percakapan tidak ditemukan.");
  }
  const existing = await prisma.deal.findUnique({
    where: { conversationId: args.conversationId },
  });
  if (!existing) {
    await ensureInitialDeal({
      tenantId: args.tenantId,
      conversationId: args.conversationId,
    });
  }
  const deal = await prisma.deal.update({
    where: { conversationId: args.conversationId },
    data: { value: args.value },
  });
  if ((existing?.value ?? 0) !== args.value) {
    await logAction({
      tenantId: args.tenantId,
      agentId: null,
      action: "deal.value_change",
      entityType: "Deal",
      entityId: deal.id,
      beforeValue: { value: existing?.value ?? 0 },
      afterValue: {
        value: args.value,
        byUserId: args.movedByUserId ?? null,
      },
      approvalStatus: "NONE",
    });
  }
  return { dealId: deal.id, value: deal.value };
}

// Paginated, filtered deals query for the kanban page.
export async function listDealsForKanban(args: {
  tenantId: string;
  stageId?: string;
  assigneeUserId?: string;
  tagId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}): Promise<{
  items: DealWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  valueTotal: number;
}> {
  const { tenantId, stageId, assigneeUserId, tagId, from, to, page, pageSize } = args;
  const where: Prisma.DealWhereInput = { tenantId };
  const conversationWhere: Prisma.ConversationWhereInput = {};
  if (stageId) where.stageId = stageId;
  if (assigneeUserId) {
    conversationWhere.assigneeUserId = assigneeUserId;
  }
  if (tagId) {
    conversationWhere.tags = { some: { tagId } };
  }
  // Date range filters on the conversation's last chat activity (the deal
  // is tied to a customer chat, so "from/to" means chat activity range).
  if (from || to) {
    conversationWhere.lastMessageAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }
  if (assigneeUserId || tagId || from || to) {
    where.conversation = conversationWhere;
  }

  const [items, total, sum] = await Promise.all([
    prisma.deal.findMany({
      where,
      include: {
        stage: true,
        conversation: {
          include: {
            contact: true,
            assignee: true,
            channel: { select: { id: true, provider: true } },
            tags: { include: { tag: true } },
            messages: {
              take: 1,
              orderBy: { createdAt: "desc" },
              select: { body: true, senderType: true, kind: true },
            },
          },
        },
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.deal.count({ where }),
    // Stage/column total for the board header - over the whole filtered set,
    // not just the loaded page.
    prisma.deal.aggregate({ where, _sum: { value: true } }),
  ]);
  return { items, total, page, pageSize, valueTotal: sum._sum.value ?? 0 };
}

// Per-stage deal counts for the funnel cone + conversion rates.
export async function funnelCounts(
  tenantId: string
): Promise<
  Array<{ stageId: string; name: string; order: number; kind: StageKind; count: number }>
> {
  const pipeline = await getOrCreatePipeline(tenantId);
  const grouped = await prisma.deal.groupBy({
    by: ["stageId"],
    where: { tenantId },
    _count: { id: true },
  });
  const countByStage = new Map<string, number>();
  for (const g of grouped) {
    countByStage.set(g.stageId, g._count.id);
  }
  return pipeline.stages.map((s) => ({
    stageId: s.id,
    name: s.name,
    order: s.order,
    kind: s.kind,
    count: countByStage.get(s.id) ?? 0,
  }));
}
