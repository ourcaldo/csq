import type { NextApiRequest, NextApiResponse } from "next";
import type { Message, Prisma } from "@prisma/client";
import { z } from "zod";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import {
  HttpError,
  paginate,
  requireTenant,
  respondError,
} from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { sendHumanReply } from "@csq/core/lib/inbox";

// Human reply body only; `to` is the conversation's customerPhone (server-side
// derived, never client-supplied).
const sendReplySchema = z.object({
  body: z.string().min(1).max(4096),
});

type ListResult = {
  items: Message[];
  total: number;
  page: number;
  pageSize: number;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Message | ListResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const { id } = req.query;
    if (typeof id !== "string") {
      return respondError(res, "VALIDATION_ERROR", "ID percakapan tidak valid.");
    }

    // Ensure the conversation belongs to this tenant before any work.
    const conversation = await prisma.conversation.findFirst({
      where: { id, tenantId },
    });
    if (!conversation) {
      return respondError(res, "NOT_FOUND", "Percakapan tidak ditemukan.");
    }

    if (req.method === "GET") {
      const { pageSize } = paginate(req.query);
      const where: Prisma.MessageWhereInput = {
        tenantId,
        conversationId: id,
      };
      const [newest, total] = await Promise.all([
        // The chat panel always wants the LATEST slice of the thread. It used
        // to load the OLDEST pageSize messages (asc, page 1) - fine until a
        // merged conversation grew past the 100 cap, at which point the newest
        // messages (and the SSE-triggered refreshes) never reached the panel.
        // Newest-first for the LIMIT, then reversed for the panel's asc render.
        // shortcut: only the newest pageSize is served; add a before-cursor
        // (load older on scroll up) if full history is ever needed.
        prisma.message.findMany({
          where,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        prisma.message.count({ where }),
      ]);
      const items = newest.reverse();
      return res.status(200).json(apiOk({ items, total, page: 1, pageSize }));
    }

    if (req.method === "POST") {
      // OWNER + STAFF can send human replies (FR-IC-005).
      if (!requireRole(session, "OWNER", "STAFF")) {
        return respondError(
          res,
          "PERMISSION_DENIED",
          "Hanya owner atau staff yang dapat membalas."
        );
      }
      const parsed = sendReplySchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(res, "VALIDATION_ERROR", parsed.error.message);
      }

      try {
        const message = await sendHumanReply({
          conversationId: id,
          tenantId,
          userId: session.user.id,
          body: parsed.data.body,
        });
        return res.status(201).json(apiOk(message));
      } catch (err) {
        if (err instanceof HttpError) {
          return respondError(res, err.code, err.message);
        }
        return respondError(res, "INTERNAL_ERROR", "Gagal mengirim balasan.");
      }
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
