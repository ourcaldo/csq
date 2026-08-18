import type { NextApiRequest, NextApiResponse } from "next";
import type { ConversationTag } from "@prisma/client";
import { z } from "zod";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError, strQuery } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

// Add a tag to a conversation. tagId must belong to the same tenant.
const addTagSchema = z.object({ tagId: z.string().uuid() });

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ConversationTag | { removed: boolean }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  const { id } = req.query;
  if (typeof id !== "string") {
    return respondError(res, "VALIDATION_ERROR", "ID percakapan tidak valid.");
  }

  // OWNER + STAFF manage tags on a conversation (FR-IC-005).
  if (!requireRole(session, "OWNER", "STAFF")) {
    return respondError(
      res,
      "PERMISSION_DENIED",
      "Hanya owner atau staff yang dapat mengelola tag."
    );
  }

  // Ensure the conversation belongs to this tenant.
  const conversation = await prisma.conversation.findFirst({
    where: { id, tenantId },
  });
  if (!conversation) {
    return respondError(res, "NOT_FOUND", "Percakapan tidak ditemukan.");
  }

  if (req.method === "POST") {
    const parsed = addTagSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    // Tag must belong to the same tenant.
    const tag = await prisma.tag.findFirst({
      where: { id: parsed.data.tagId, tenantId },
    });
    if (!tag) {
      return respondError(res, "NOT_FOUND", "Tag tidak ditemukan.");
    }
    // Upsert handles the @@unique([conversationId, tagId]) — idempotent re-add.
    const ct = await prisma.conversationTag.upsert({
      where: {
        conversationId_tagId: { conversationId: id, tagId: parsed.data.tagId },
      },
      update: {},
      create: { tenantId, conversationId: id, tagId: parsed.data.tagId },
    });
    return res.status(201).json(apiOk(ct));
  }

  if (req.method === "DELETE") {
    const tagId = strQuery(req.query, "tagId");
    if (!tagId) {
      return respondError(res, "VALIDATION_ERROR", "tagId diperlukan.");
    }
    const existing = await prisma.conversationTag.findFirst({
      where: { conversationId: id, tagId },
    });
    if (!existing) {
      return respondError(res, "NOT_FOUND", "Tag tidak terpasang pada percakapan ini.");
    }
    await prisma.conversationTag.delete({ where: { id: existing.id } });
    return res.status(200).json(apiOk({ removed: true }));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
