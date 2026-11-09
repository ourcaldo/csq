import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin, auditAdminAction } from "@/lib/admin-auth";
import { z } from "zod";
import { withSystemContext } from "@csq/core/lib/tenant-context";

// Operations (PRD 13 Phase 3): the worker's queues and locks, visible.
// POST = retry a FAILED outbound message (FAILED -> QUEUED).

const retrySchema = z.object({ messageId: z.string().uuid() });

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  return withSystemContext(async () => {

    if (req.method === "GET") {
      const [locks, outboxStats, failedMessages, commands, sources] = await Promise.all([
        prisma.systemLock.findMany({ orderBy: { key: "asc" } }),
        prisma.outboundMessage.groupBy({ by: ["status"], _count: { id: true } }),
        prisma.outboundMessage.findMany({
          where: { status: "FAILED" },
          orderBy: { updatedAt: "desc" },
          take: 20,
          select: { id: true, tenantId: true, toJid: true, error: true, updatedAt: true },
        }),
        prisma.channelCommand.findMany({
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { channel: { select: { provider: true } } },
        }),
        prisma.dataSource.findMany({
          // ADM-5 (PRD 16): failing sources stay visible so a broken sync is
          // seen, not hidden behind the ACTIVE filter.
          where: { type: "GOOGLE_SHEETS", status: { in: ["ACTIVE", "ERROR"] } },
          orderBy: { lastSyncAt: "asc" },
          take: 20,
          select: { id: true, name: true, status: true, lastSyncAt: true, tenantId: true },
        }),
      ]);
      return res.status(200).json(apiOk({
        locks: locks.map((l) => ({
          key: l.key,
          lockedUntil: l.lockedUntil.toISOString(),
          isHeld: l.lockedUntil > new Date(),
          updatedAt: l.updatedAt.toISOString(),
        })),
        outbox: outboxStats.map((s) => ({ status: s.status, count: s._count.id })),
        failedMessages: failedMessages.map((m) => ({ ...m, updatedAt: m.updatedAt.toISOString() })),
        commands: commands.map((c) => ({
          id: c.id, kind: c.kind, status: c.status,
          channelId: c.channelId, provider: c.channel.provider,
          createdAt: c.createdAt.toISOString(),
        })),
        sources: sources.map((s) => ({
          ...s,
          lastSyncAt: s.lastSyncAt?.toISOString() ?? null,
        })),
      }));
    }

    if (req.method === "POST") {
      const parsed = retrySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json(apiError("VALIDATION_ERROR", "messageId diperlukan."));
      }
      const result = await prisma.outboundMessage.updateMany({
        where: { id: parsed.data.messageId, status: "FAILED" },
        data: { status: "QUEUED", error: null },
      });
      if (result.count === 0) {
        return res.status(404).json(apiError("NOT_FOUND", "Pesan tidak ditemukan atau bukan FAILED."));
      }
      await auditAdminAction({
        adminId: admin.adminId, action: "outbox.retry",
        targetType: "OutboundMessage", targetId: parsed.data.messageId,
      });
      return res.status(200).json(apiOk({ retried: true }));
    }

    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));

  });
}
