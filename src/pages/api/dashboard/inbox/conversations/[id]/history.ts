import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

// GET /api/dashboard/inbox/conversations/[id]/history — the customer
// lifecycle timeline for the contact-details panel. Merges three sources the
// DB already records server-side (one request, no client-side N+1):
//   1. First chat — conversation createdAt anchor.
//   2. Orders — by the conversation's customerPhone (the *customer* lifecycle,
//      so orders from any channel appear; same linkage the agent window
//      context uses).
//   3. Pipeline moves — DealStageHistory rows via the conversation's deal,
//      including who moved it (human vs AI auto-move).
// Bounded: newest-first, capped to HISTORY_LIMIT entries.
//
// Auth: dashboard session, tenant-scoped. Read-only.

const HISTORY_LIMIT = 20;

type HistoryEvent = {
  kind: "FIRST_CHAT" | "ORDER" | "STAGE_MOVE";
  at: string; // ISO timestamp
  // FIRST_CHAT: no extras. ORDER: orderNumber, amount, status.
  // STAGE_MOVE: fromStage, toStage, actor ("AI" | user name | null), reason.
  orderNumber?: string;
  amount?: string;
  status?: string;
  fromStage?: string;
  toStage?: string;
  actor?: string | null;
  reason?: string | null;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ events: HistoryEvent[] }>>
) {
  if (req.method !== "GET") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  const { id } = req.query;
  if (typeof id !== "string") {
    return respondError(res, "VALIDATION_ERROR", "ID percakapan tidak valid.");
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      createdAt: true,
      customerPhone: true,
      // Deal links Deal.conversationId -> Conversation (1:1), not a dealId
      // column here.
      deal: { select: { id: true } },
    },
  });
  if (!conversation) {
    return respondError(res, "NOT_FOUND", "Percakapan tidak ditemukan.");
  }

  // All three sources in parallel; each query is tenant-scoped.
  const [orders, stageHistories] = await Promise.all([
    conversation.customerPhone
      ? prisma.order.findMany({
          where: { tenantId, customerPhone: conversation.customerPhone },
          orderBy: { createdAt: "desc" },
          take: HISTORY_LIMIT,
          select: { id: true, createdAt: true, status: true, totalAmount: true },
        })
      : Promise.resolve([]),
    conversation.deal
      ? prisma.dealStageHistory.findMany({
          where: { tenantId, dealId: conversation.deal.id },
          orderBy: { createdAt: "desc" },
          take: HISTORY_LIMIT,
          select: {
            createdAt: true,
            fromStageId: true,
            toStageId: true,
            movedByUserId: true,
            movedByAgentId: true,
            reason: true,
          },
        })
      : Promise.resolve([]),
  ]);

  // Resolve stage names + the human actor name for stage moves in one
  // batched lookup each (ids → names), never per-row.
  const stageIds = [
    ...new Set(
      stageHistories.flatMap((h) => [h.fromStageId, h.toStageId])
    ),
  ];
  const userIds = [
    ...new Set(
      stageHistories
        .map((h) => h.movedByUserId)
        .filter((u): u is string => u !== null)
    ),
  ];
  const [stages, users] = await Promise.all([
    stageIds.length
      ? prisma.stage.findMany({
          where: { tenantId, id: { in: stageIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    userIds.length
      ? prisma.user.findMany({
          where: { tenantId, id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([] as { id: string; name: string | null; email: string }[]),
  ]);
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const userName = new Map(
    users.map((u) => [u.id, u.name ?? u.email])
  );

  const events: HistoryEvent[] = [
    // First-chat anchor — always present, oldest event.
    { kind: "FIRST_CHAT" as const, at: conversation.createdAt.toISOString() },
    ...orders.map((o) => ({
      kind: "ORDER" as const,
      at: o.createdAt.toISOString(),
      // Human-friendly order number (#<first 8 uuid chars>, uppercase) —
      // matches what the agent quotes to the customer (tools/order.ts).
      orderNumber: `#${o.id.slice(0, 8).toUpperCase()}`,
      amount: o.totalAmount.toString(),
      status: o.status,
    })),
    ...stageHistories.map((h) => ({
      kind: "STAGE_MOVE" as const,
      at: h.createdAt.toISOString(),
      fromStage: stageName.get(h.fromStageId) ?? "—",
      toStage: stageName.get(h.toStageId) ?? "—",
      actor: h.movedByAgentId
        ? "AI"
        : h.movedByUserId
        ? userName.get(h.movedByUserId) ?? null
        : null,
      reason: h.reason,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, HISTORY_LIMIT);

  return res.status(200).json(apiOk({ events }));
}
