import type { NextApiRequest, NextApiResponse } from "next";
import type { Message } from "@prisma/client";
import { z } from "zod";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { logHuman } from "@/lib/audit";

// Private (internal) note on a conversation — visible to the team in the inbox
// but NOT sent to the customer (isInternal: true, no provider dispatch).
// OWNER + STAFF can post notes (plan 7.7 / FR-IC-005).
const noteSchema = z.object({ body: z.string().min(1).max(4096) });

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Message>>
) {
  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER", "STAFF")) {
    return respondError(
      res,
      "PERMISSION_DENIED",
      "Hanya owner atau staff yang dapat menambah catatan."
    );
  }
  const tenantId = requireTenant(session);

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

  return res.status(201).json(apiOk(message));
}
