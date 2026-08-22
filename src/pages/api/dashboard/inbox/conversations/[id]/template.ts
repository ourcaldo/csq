import type { NextApiRequest, NextApiResponse } from "next";
import type { Message } from "@prisma/client";
import { z } from "zod";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import {
  HttpError,
  requireTenant,
  respondError,
} from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { recordOutboundMessage } from "@/lib/inbox";
import { getProvider } from "@/lib/whatsapp-provider";
import { logAction } from "@/lib/audit";

// Human-initiated template send. Templates are pre-approved in Meta Business
// Manager and are the only way to reach a customer outside the 24h Cloud API
// customer-service window — so this path deliberately does NOT apply the 24h
// guard that `sendHumanReply` enforces. Baileys' sendTemplate delegates to
// free-form text (no window restriction either way).
const sendTemplateSchema = z.object({
  templateName: z.string().min(1),
  language: z.string().default("id"),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Message>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  const { id } = req.query;
  if (typeof id !== "string") {
    return respondError(res, "VALIDATION_ERROR", "ID percakapan tidak valid.");
  }

  // Ensure the conversation belongs to this tenant before any work.
  const conversation = await prisma.conversation.findFirst({
    where: { id, tenantId },
    include: { channel: true },
  });
  if (!conversation) {
    return respondError(res, "NOT_FOUND", "Percakapan tidak ditemukan.");
  }

  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  // OWNER + STAFF can send templates (same gate as human replies, FR-IC-005).
  if (!requireRole(session, "OWNER", "STAFF")) {
    return respondError(
      res,
      "PERMISSION_DENIED",
      "Hanya owner atau staff yang dapat mengirim template."
    );
  }

  const parsed = sendTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    return respondError(res, "VALIDATION_ERROR", parsed.error.message);
  }

  try {
    const provider = getProvider(conversation.channel);
    // Templates are allowed OUTSIDE the 24h window — do not apply the guard.
    const result = await provider.sendTemplate({
      to: conversation.customerPhone,
      templateName: parsed.data.templateName,
      languageCode: parsed.data.language,
    });

    const body = `[Template: ${parsed.data.templateName}]`;
    const message = await recordOutboundMessage({
      tenantId,
      conversationId: id,
      senderUserId: session.user.id,
      body,
      waMessageId: result.waMessageId,
    });

    await prisma.conversation.update({
      where: { id },
      data: { lastMessageAt: new Date() },
    });

    await logAction({
      tenantId,
      agentId: null,
      action: "conversation.human_template",
      entityType: "Message",
      entityId: message.id,
      approvalStatus: "NONE",
      customerPhone: conversation.customerPhone,
      afterValue: {
        templateName: parsed.data.templateName,
        language: parsed.data.language,
        waMessageId: result.waMessageId,
      },
    });

    return res.status(201).json(apiOk(message));
  } catch (err) {
    if (err instanceof HttpError) {
      return respondError(res, err.code, err.message);
    }
    return respondError(res, "INTERNAL_ERROR", "Gagal mengirim template.");
  }
}
