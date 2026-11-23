import type { NextApiRequest, NextApiResponse } from "next";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import { visibleChannelIds, composeChannelIds } from "@csq/core/lib/channel-access";
import prisma from "@csq/core/lib/db";
import {
  HttpError,
  paginate,
  requireTenant,
  respondError,
} from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { assignConversation } from "@csq/core/lib/inbox";
import { logHuman } from "@csq/core/lib/audit";

type Detail = Prisma.ConversationGetPayload<{
  include: {
    contact: true;
    assignedAgent: { select: { id: true; name: true; status: true } };
    assignee: { select: { id: true; name: true; email: true; isOwner: true } };
    tags: { include: { tag: true } };
    messages: true;
  };
}>;

// Audit run-3: the assignee/assignedAgent selects must mask the full rows
// (passwordHash / instructions) on every path that returns a conversation.
const DETAIL_INCLUDE = {
  contact: {
    include: {
      categories: { include: { category: true } },
      tags: { include: { tag: true } },
    },
  },
  assignedAgent: { select: { id: true, name: true, status: true } },
  assignee: { select: { id: true, name: true, email: true, isOwner: true } },
  tags: { include: { tag: true } },
} satisfies Prisma.ConversationInclude;

// PATCH body: any subset of status / assignment / reply-channel override.
// assignedAgentId and assigneeUserId are mutually exclusive (XOR enforced in
// assignConversation). replyChannelId is the PRD 28 Part A remembered
// composer selection: null clears it (follow last inbound again).
const conversationPatchSchema = z.object({
  status: z.enum(["OPEN", "PENDING", "RESOLVED"]).optional(),
  assignedAgentId: z.string().uuid().nullable().optional(),
  assigneeUserId: z.string().uuid().nullable().optional(),
  replyChannelId: z.string().uuid().nullable().optional(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Detail | { id: string; lastReadAt: string }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const { id } = req.query;
    if (typeof id !== "string") {
      return respondError(res, "VALIDATION_ERROR", "ID percakapan tidak valid.");
    }
    // PRD 29 section 6: a user only reaches conversations on channels their
    // grants let them see (owner / Akses Penuh -> null = unrestricted).
    const visible = await visibleChannelIds(session);
    const scope = visible ? { channelId: { in: visible } } : {};

    if (req.method === "GET") {
      const { skip, take } = paginate(req.query);
      const conv = await prisma.conversation.findFirst({
        where: { id, tenantId, ...scope },
        include: {
          ...DETAIL_INCLUDE,
          // Newest last (asc by time) for chat-panel rendering.
          messages: { orderBy: { createdAt: "asc" }, skip, take },
        },
      });
      if (!conv) return respondError(res, "NOT_FOUND", "Percakapan tidak ditemukan.");
      return res.status(200).json(apiOk(conv));
    }

    if (req.method === "POST") {
      // Mark-as-read: upsert the caller's ConversationRead watermark to now.
      // Called when the user opens a conversation - clears the unread badge.
      if (!requirePermission(session, "inbox.lihat")) {
        return respondError(res, "PERMISSION_DENIED", "Tidak punya akses percakapan.");
      }
      const existing = await prisma.conversation.findFirst({
        where: { id, tenantId, ...scope },
        select: { id: true },
      });
      if (!existing) return respondError(res, "NOT_FOUND", "Percakapan tidak ditemukan.");
      const lastReadAt = new Date();
      await prisma.conversationRead.upsert({
        where: { conversationId_userId: { conversationId: id, userId: session.user.id } },
        create: { conversationId: id, userId: session.user.id, tenantId, lastReadAt },
        update: { lastReadAt },
      });
      return res.status(200).json(apiOk({ id, lastReadAt: lastReadAt.toISOString() }));
    }

    if (req.method === "PATCH") {
      if (!requirePermission(session, "inbox.lihat")) {
        return respondError(res, "PERMISSION_DENIED", "Tidak punya akses percakapan.");
      }
      const parsed = conversationPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(res, "VALIDATION_ERROR", parsed.error.message);
      }
      const { status, assignedAgentId, assigneeUserId, replyChannelId } = parsed.data;
      // PRD 29: assignment is its own permission (inbox.tugaskan).
      if (
        (assignedAgentId !== undefined || assigneeUserId !== undefined) &&
        !requirePermission(session, "inbox.tugaskan")
      ) {
        return respondError(res, "PERMISSION_DENIED", "Tidak punya izin menugaskan percakapan.");
      }

      const existing = await prisma.conversation.findFirst({
        where: { id, tenantId, ...scope },
      });
      if (!existing) {
        return respondError(res, "NOT_FOUND", "Percakapan tidak ditemukan.");
      }

      // FEA-6 (PRD 16): the assignment picker can target any tenant member -
      // verify the chosen user belongs to this tenant before connecting
      // (defense in depth on top of RLS).
      if (assigneeUserId) {
        const assignee = await prisma.user.findFirst({
          where: { id: assigneeUserId, tenantId },
          select: { id: true },
        });
        if (!assignee) {
          return respondError(res, "VALIDATION_ERROR", "User tidak ditemukan dalam tim ini.");
        }
      }
      // Audit run-3 (bff.assign-agent-crosstenant): same tenant check for the
      // agent branch - assigneeUserId was verified, assignedAgentId was not.
      if (assignedAgentId) {
        const agent = await prisma.agent.findFirst({
          where: { id: assignedAgentId, tenantId },
          select: { id: true },
        });
        if (!agent) {
          return respondError(res, "VALIDATION_ERROR", "Agent tidak ditemukan dalam tenant ini.");
        }
      }

      try {
        if (assignedAgentId !== undefined || assigneeUserId !== undefined) {
          const updated = await assignConversation(id, tenantId, {
            agentId: assignedAgentId ?? null,
            userId: assigneeUserId ?? null,
          });
          // FEA-6 (PRD 16): reassignment audit with before/after (the lib row
          // logs the resulting assignment; this row records the human change).
          await logHuman({
            tenantId,
            action: "conversation.reassign",
            entityType: "Conversation",
            entityId: id,
            beforeValue: {
              assignedAgentId: existing.assignedAgentId,
              assigneeUserId: existing.assigneeUserId,
            },
            afterValue: {
              assignedAgentId: updated.assignedAgentId,
              assigneeUserId: updated.assigneeUserId,
            },
          });
        }
        if (status) {
          await prisma.conversation.update({
            where: { id },
            data: { status },
          });
        }
        // PRD 28 Part A + PRD 29: persist / clear the reply-channel override.
        // The override target must be a channel the user can compose on.
        // Merge into the existing settings Json (session-close flags live
        // there).
        if (replyChannelId !== undefined) {
          if (replyChannelId !== null) {
            const ch = await prisma.channel.findFirst({
              where: { id: replyChannelId, tenantId },
              select: { id: true },
            });
            if (!ch) {
              return respondError(res, "VALIDATION_ERROR", "Saluran tidak ditemukan dalam tenant ini.");
            }
            const compose = await composeChannelIds(session);
            if (compose !== null && !compose.includes(replyChannelId)) {
              return respondError(res, "PERMISSION_DENIED", "Tidak punya izin mengirim di saluran itu.");
            }
          }
          const merged = {
            ...((existing.settings as Record<string, unknown> | null) ?? {}),
            replyChannelId,
          };
          await prisma.conversation.update({
            where: { id },
            data: { settings: merged },
          });
        }
      } catch (err) {
        if (err instanceof HttpError) {
          return respondError(res, err.code, err.message);
        }
        return respondError(res, "INTERNAL_ERROR", "Gagal memperbarui percakapan.");
      }

      const conv = await prisma.conversation.findFirst({
        where: { id, tenantId, ...scope },
        include: {
          ...DETAIL_INCLUDE,
          messages: { orderBy: { createdAt: "asc" } },
        },
      });
      if (!conv) return respondError(res, "NOT_FOUND", "Percakapan tidak ditemukan.");
      return res.status(200).json(apiOk(conv));
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
