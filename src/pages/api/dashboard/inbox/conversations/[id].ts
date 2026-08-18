import type { NextApiRequest, NextApiResponse } from "next";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import {
  HttpError,
  paginate,
  requireTenant,
  respondError,
} from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { assignConversation } from "@/lib/inbox";

type Detail = Prisma.ConversationGetPayload<{
  include: {
    contact: true;
    assignedAgent: true;
    assignee: true;
    tags: { include: { tag: true } };
    messages: true;
  };
}>;

// PATCH body: any subset of status / assignment. assignedAgentId and
// assigneeUserId are mutually exclusive (XOR enforced in assignConversation).
const conversationPatchSchema = z.object({
  status: z.enum(["OPEN", "PENDING", "RESOLVED"]).optional(),
  assignedAgentId: z.string().uuid().nullable().optional(),
  assigneeUserId: z.string().uuid().nullable().optional(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Detail>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  const { id } = req.query;
  if (typeof id !== "string") {
    return respondError(res, "VALIDATION_ERROR", "ID percakapan tidak valid.");
  }

  if (req.method === "GET") {
    const { skip, take } = paginate(req.query);
    const conv = await prisma.conversation.findFirst({
      where: { id, tenantId },
      include: {
        contact: true,
        assignedAgent: true,
        assignee: true,
        tags: { include: { tag: true } },
        // Newest last (asc by time) for chat-panel rendering.
        messages: { orderBy: { createdAt: "asc" }, skip, take },
      },
    });
    if (!conv) return respondError(res, "NOT_FOUND", "Percakapan tidak ditemukan.");
    return res.status(200).json(apiOk(conv));
  }

  if (req.method === "PATCH") {
    // OWNER + STAFF can update status / assignment (FR-AU-009, FR-IC-005).
    if (!requireRole(session, "OWNER", "STAFF")) {
      return respondError(
        res,
        "PERMISSION_DENIED",
        "Hanya owner atau staff yang dapat mengubah percakapan."
      );
    }
    const parsed = conversationPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    const { status, assignedAgentId, assigneeUserId } = parsed.data;

    const existing = await prisma.conversation.findFirst({
      where: { id, tenantId },
    });
    if (!existing) {
      return respondError(res, "NOT_FOUND", "Percakapan tidak ditemukan.");
    }

    try {
      if (assignedAgentId !== undefined || assigneeUserId !== undefined) {
        await assignConversation(id, tenantId, {
          agentId: assignedAgentId ?? null,
          userId: assigneeUserId ?? null,
        });
      }
      if (status) {
        await prisma.conversation.update({
          where: { id },
          data: { status },
        });
      }
    } catch (err) {
      if (err instanceof HttpError) {
        return respondError(res, err.code, err.message);
      }
      return respondError(res, "INTERNAL_ERROR", "Gagal memperbarui percakapan.");
    }

    const conv = await prisma.conversation.findFirst({
      where: { id, tenantId },
      include: {
        contact: true,
        assignedAgent: true,
        assignee: true,
        tags: { include: { tag: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!conv) return respondError(res, "NOT_FOUND", "Percakapan tidak ditemukan.");
    return res.status(200).json(apiOk(conv));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
