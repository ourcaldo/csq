import type { NextApiRequest, NextApiResponse } from "next";
import type { Message } from "@prisma/client";
import { z } from "zod";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { logHuman } from "@csq/core/lib/audit";

// Private (internal) note on a conversation - visible to the team in the inbox
// but NOT sent to the customer (isInternal: true, no provider dispatch).
// OWNER + STAFF can post notes (plan 7.7 / FR-IC-005).
//
// GET lists every note on the conversation (newest first, with author and
// time) for the right panel's note list - reading past notes should not
// require scrolling the chat thread to the top (owner request 2026-11-10).
const noteSchema = z.object({ body: z.string().min(1).max(4096) });

// Notes list item: the Message row plus the author's display name.
type NoteItem = Message & { senderUserName: string | null };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Message | { items: NoteItem[] }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER", "STAFF")) {
    return respondError(
      res,
      "PERMISSION_DENIED",
      "Hanya owner atau staff yang dapat mengakses catatan."
    );
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const { id } = req.query;
    if (typeof id !== "string") {
      return respondError(res, "VALIDATION_ERROR", "ID percakapan tidak valid.");
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id, tenantId },
    });
    if (!conversation) {
      return respondError(res, "NOT_FOUND", "Percakapan tidak ditemukan.");
    }

    if (req.method === "GET") {
      const rows = await prisma.message.findMany({
        where: { tenantId, conversationId: id, isInternal: true },
        orderBy: { createdAt: "desc" },
        // Bounded: a long support history must not load unbounded rows.
        take: 200,
        include: { senderUser: { select: { name: true, email: true } } },
      });
      const items = rows.map(({ senderUser, ...m }) => ({
        ...m,
        senderUserName: senderUser?.name ?? senderUser?.email ?? null,
      }));
      return res.status(200).json(apiOk({ items }));
    }

    if (req.method === "POST") {
      const parsed = noteSchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(res, "VALIDATION_ERROR", parsed.error.message);
      }

      const message = await prisma.message.create({
        data: {
          tenantId,
          conversationId: id,
          direction: "OUTBOUND",
          senderType: "HUMAN",
          senderUserId: session.user.id,
          body: parsed.data.body,
          isInternal: true,
        },
      });
      // Enrich with the author's display name (same shape as the GET) so the
      // bubble shows who wrote it immediately, not after the next refresh.
      const enriched: NoteItem = {
        ...message,
        senderUserName: session.user.name ?? session.user.email ?? null,
      };

      await prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: new Date() },
      });

      await logHuman({
        tenantId,
        action: "conversation.note",
        entityType: "Message",
        entityId: message.id,
        afterValue: { body: parsed.data.body, isInternal: true },
      });

      return res.status(201).json(apiOk(enriched));
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
