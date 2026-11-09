import type { NextApiRequest, NextApiResponse } from "next";
import type { Message } from "@prisma/client";
import { z } from "zod";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import {
  HttpError,
  requireTenant,
  respondError,
} from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { recordOutboundMessage } from "@csq/core/lib/inbox";
import { enqueueOutbound, awaitOutbound } from "@csq/core/lib/outbox";
import { logAction } from "@csq/core/lib/audit";

// Human-initiated template send. Templates are pre-approved in Meta Business
// Manager and are the only way to reach a customer outside the 24h Cloud API
// customer-service window - so this path deliberately does NOT apply the 24h
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

  return withTenantContext(tenantId, async () => {
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
      // Phase 6: the send flows through the worker's outbox; the bounded await
      // keeps the old synchronous contract (Message row only on success).
      const outboxId = await enqueueOutbound({
        tenantId,
        channelId: conversation.channel.id,
        to: conversation.customerPhone,
        templateName: parsed.data.templateName,
        language: parsed.data.language,
        source: "TEMPLATE_SEND",
      });
      const result = await awaitOutbound(outboxId);
      if (result.status !== "SENT") {
        throw new HttpError("INTERNAL_ERROR", result.error ?? "Gagal mengirim template.");
      }

      const body = `[Template: ${parsed.data.templateName}]`;
      const message = await recordOutboundMessage({
        tenantId,
        conversationId: id,
        senderUserId: session.user.id,
        body,
        waMessageId: result.waMessageId ?? undefined,
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
  });
}
