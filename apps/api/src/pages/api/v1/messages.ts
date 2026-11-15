import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { requireApiAuth } from "@csq/core/lib/api-auth";
import { assignRequestId } from "@csq/core/lib/request-id";
import { checkRateLimit } from "@csq/core/lib/rate-limit";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import {
  findOrCreateConversation,
  recordOutboundMessage,
  CLOUD_API_WINDOW_MS,
} from "@csq/core/lib/inbox";
import { enqueueOutbound, awaitOutbound } from "@csq/core/lib/outbox";
import { logAction } from "@csq/core/lib/audit";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import {
  sendMessageRequestSchema,
  type SendMessageResult,
} from "@csq/core/lib/api-contract";

// POST /api/v1/messages (PRD 24) - send a WhatsApp message from a tenant's
// connected channel: text, an image, or an image with a caption (text).
// Auth: tenant API key or user access JWT (service tokens rejected - they are
// not tenant-bound). The send rides the same pipeline as a CRM dashboard
// reply: 24h window check (Cloud API), worker outbox (web processes hold no
// socket), OUTBOUND Message recorded in the conversation, audit. API sends do
// NOT take the conversation over - the AI keeps owning it (PRD 24 decision).

const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const MEDIA_TIMEOUT_MS = 15_000;

async function fetchImage(url: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Media fetch failed (HTTP ${res.status}).`);
  const mimeType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!mimeType.startsWith("image/")) {
    throw new Error("Media URL must point at an image (png, jpeg, webp, gif).");
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0) throw new Error("Media is empty.");
  if (bytes.length > MAX_MEDIA_BYTES) {
    throw new Error("Media exceeds the 10 MB limit.");
  }
  return { bytes, mimeType };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<SendMessageResult>>
) {
  assignRequestId(req, res);
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));
  }

  const auth = await requireApiAuth(req);
  if (!auth) {
    res.setHeader("WWW-Authenticate", "Bearer");
    return res.status(401).json(apiError("UNAUTHORIZED", "API key required"));
  }
  if (auth.kind === "SERVICE") {
    return res
      .status(403)
      .json(apiError("PERMISSION_DENIED", "Service tokens cannot send tenant messages"));
  }
  const credentialId = auth.kind === "API_KEY" ? auth.keyId : auth.userId;
  if (!checkRateLimit(`messages:${credentialId}`, 60, 60_000)) {
    return res.status(429).json(apiError("RATE_LIMITED", "Too many requests"));
  }

  const parsed = sendMessageRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json(
        apiError(
          "VALIDATION_ERROR",
          parsed.error.issues[0]?.message ?? "Invalid request body"
        )
      );
  }
  const { text, media, channelId } = parsed.data;
  // Conversation identity is bare digits (matches the inbox's canonical form).
  const to = parsed.data.to.replace(/[^0-9]/g, "");

  return withTenantContext(auth.tenantId, async () => {
    // The channel is REQUIRED (owner decision 2026-11-15): tenants will run
    // multiple channels, so the sender must name the one to send from. It
    // must belong to the token's tenant and be connected.
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel || channel.tenantId !== auth.tenantId) {
      return res
        .status(403)
        .json(apiError("PERMISSION_DENIED", "Channel does not belong to your tenant"));
    }
    if (channel.status !== "CONNECTED") {
      return res
        .status(409)
        .json(apiError("NO_CONNECTED_CHANNEL", "The channel is not connected"));
    }

    // Media is fetched and stored BEFORE any send - a bad URL never leaves a
    // half-sent message behind.
    let mediaId: string | undefined;
    if (media) {
      try {
        const image = await fetchImage(media.url);
        const asset = await prisma.mediaAsset.create({
          data: {
            tenantId: auth.tenantId,
            mimeType: image.mimeType,
            byteSize: image.bytes.length,
            data: image.bytes,
          },
        });
        mediaId = asset.id;
      } catch (err) {
        return res
          .status(400)
          .json(
            apiError(
              "VALIDATION_ERROR",
              err instanceof Error ? err.message : "Invalid media URL"
            )
          );
      }
    }

    // Same find-or-create as inbound: a RESOLVED conversation reopens.
    const { conversation } = await findOrCreateConversation(
      auth.tenantId,
      channel.id,
      to
    );

    // 24h customer-service window - Cloud API only (same rule as the
    // dashboard reply). Baileys has no such enforcement.
    if (channel.provider === "CLOUD_API") {
      const lastInbound = await prisma.message.findFirst({
        where: { conversationId: conversation.id, direction: "INBOUND" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      const withinWindow =
        !!lastInbound &&
        Date.now() - lastInbound.createdAt.getTime() <= CLOUD_API_WINDOW_MS;
      if (!withinWindow) {
        return res
          .status(422)
          .json(
            apiError(
              "WINDOW_CLOSED",
              "The 24h customer-service window is closed on the Cloud API - an approved template is required for proactive messages."
            )
          );
      }
    }

    // Web processes hold no socket: the send goes through the worker outbox
    // (same queue as every dashboard reply) with a bounded await.
    const outboxId = await enqueueOutbound({
      tenantId: auth.tenantId,
      channelId: channel.id,
      to,
      ...(text ? { body: text } : {}),
      ...(mediaId ? { mediaId } : {}),
      source: "REPLY",
    });
    const sendResult = await awaitOutbound(outboxId);
    if (sendResult.status !== "SENT") {
      return res
        .status(502)
        .json(apiError("SEND_FAILED", sendResult.error ?? "Send failed"));
    }

    // Record exactly like a dashboard reply, minus the takeover (PRD 24) -
    // and labelled as an API send so the inbox shows its origin.
    const message = await recordOutboundMessage({
      tenantId: auth.tenantId,
      conversationId: conversation.id,
      senderType: "API",
      ...(auth.kind === "JWT_USER" ? { senderUserId: auth.userId } : {}),
      body: text ?? "",
      waMessageId: sendResult.waMessageId ?? undefined,
      ...(mediaId ? { kind: "MEDIA" as const, mediaId } : {}),
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    await logAction({
      tenantId: auth.tenantId,
      agentId: null,
      action: "api.message_send",
      entityType: "Message",
      entityId: message.id,
      approvalStatus: "NONE",
      customerPhone: to,
      afterValue: {
        channelId: channel.id,
        media: Boolean(mediaId),
        chars: (text ?? "").length,
      },
    });

    return res.status(200).json(
      apiOk({
        messageId: message.id,
        conversationId: conversation.id,
        channelId: channel.id,
        ...(sendResult.waMessageId ? { waMessageId: sendResult.waMessageId } : {}),
      })
    );
  });
}
