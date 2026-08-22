import { Prisma, StageKind } from "@prisma/client";
import prisma from "@/lib/db";
import { logAction } from "@/lib/audit";
import { HttpError } from "@/lib/queries";

// Pipeline / deal-stage core logic (SDD §4.4 pattern). One pipeline per tenant,
// lazily seeded from the default template. The AI agent and humans both move a
// conversation's deal via setConversationStage; every move is audited and recorded
// in DealStageHistory. Server-only.

export type PipelineWithStages = Prisma.PipelineGetPayload<{
  include: { stages: true };
}>;

// A deal joined with its stage + conversation (contact, assignee) for the kanban.
export type DealWithRelations = Prisma.DealGetPayload<{
  include: { stage: true; conversation: { include: { contact: true; assignee: true } } };
}>;

// Default pipeline template — copied per tenant on first Pipeline-page open.
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
// App-level check-then-create (one pipeline per tenant); a DB partial unique on
// (tenantId) would harden this further if concurrency ever warrants it.
export async function getOrCreatePipeline(
  tenantId: string
): Promise<PipelineWithStages> {
  const existing = await prisma.pipeline.findFirst({
    where: { tenantId },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  if (existing) return existing;

  await prisma.pipeline.create({
    data: {
      tenantId,
      name: DEFAULT_PIPELINE_NAME,
      stages: {
        create: DEFAULT_STAGES.map((s) => ({ tenantId, ...s })),
      },
    },
  });
  return prisma.pipeline.findFirstOrThrow({
    where: { tenantId },
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
}): Promise<{ items: DealWithRelations[]; total: number; page: number; pageSize: number }> {
  const { tenantId, stageId, assigneeUserId, tagId, from, to, page, pageSize } = args;
  const where: Prisma.DealWhereInput = { tenantId };
  if (stageId) where.stageId = stageId;
  if (assigneeUserId) {
    where.conversation = { assigneeUserId };
  }
  if (tagId) {
    where.conversation = { tags: { some: { tagId } } };
  }
  // Date range filters on the conversation's last chat activity (the deal
  // is tied to a customer chat, so "from/to" means chat activity range).
  if (from || to) {
    where.conversation = {
      ...(where.conversation as Prisma.ConversationWhereInput),
      lastMessageAt: {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      },
    };
  }

  const [items, total] = await Promise.all([
    prisma.deal.findMany({
      where,
      include: {
        stage: true,
        conversation: { include: { contact: true, assignee: true } },
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.deal.count({ where }),
  ]);
  return { items, total, page, pageSize };
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
