import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { requireApiAuth } from "@csq/core/lib/api-auth";
import { hasPermission } from "@csq/core/lib/permissions-catalog";
import { assignRequestId } from "@csq/core/lib/request-id";
import { checkRateLimit } from "@csq/core/lib/rate-limit";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import {
  findOrCreateConversation,
  recordOutboundMessage,
  setContactSource,
  CLOUD_API_WINDOW_MS,
} from "@csq/core/lib/inbox";
import { enqueueOutbound, awaitOutbound } from "@csq/core/lib/outbox";
import { logAction } from "@csq/core/lib/audit";
import { safeFetch } from "@csq/core/lib/ssrf-guard";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import {
  sendMessageRequestSchema,
  type SendMessageResult,
} from "@csq/core/lib/api-contract";

// POST /api/v1/messages (PRD 24) - send a WhatsApp message from a tenant's
// connected channel: text, an image, an image with a caption, or a document
// (amendment 2026-11-18). Auth: tenant API key or user access JWT (service
// tokens rejected - they are not tenant-bound). The send rides the same
// pipeline as a CRM dashboard reply: 24h window check (Cloud API), worker
// outbox (web processes hold no socket), OUTBOUND Message recorded in the
// conversation, audit. API sends do NOT take the conversation over - the AI
// keeps owning it (PRD 24 decision).

const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const MEDIA_TIMEOUT_MS = 15_000;

// Same document allow-list as the dashboard inbox upload route (security
// audit run-1, finding media-serving.stored-content-injection): the API send
// path must not be the mime bypass.
const ALLOWED_DOC_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
]);

async function fetchMedia(
  url: string,
  kind: "image" | "document"
): Promise<{ bytes: Buffer; mimeType: string }> {
  // SSRF guard (audit run-1): http(s) only, public hosts only, re-validated
  // on every redirect hop. All failures map to one generic message so the
  // fetch cannot double as an internal port/status oracle.
  const res = await safeFetch(url, { timeoutMs: MEDIA_TIMEOUT_MS });
  if (!res.ok) throw new Error("Media URL tidak dapat diambil.");
  const mimeType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (kind === "image" && !mimeType.startsWith("image/")) {
    throw new Error("Media URL must point at an image (png, jpeg, webp, gif).");
  }
  if (kind === "document" && !ALLOWED_DOC_MIME.has(mimeType)) {
    throw new Error("Media URL must point at a document (pdf, office, txt).");
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
  // PRD 29 section 8 amendment: the user realm enforces the catalog - a
  // JWT_USER without inbox.balas cannot send customer messages here.
  if (auth.kind === "JWT_USER" && !hasPermission(auth, "inbox.balas")) {
    return res
      .status(403)
      .json(apiError("PERMISSION_DENIED", "Role lacks inbox.balas"));
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
  const { text, media, channelId, source } = parsed.data;
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
        const fetched = await fetchMedia(media.url, media.kind);
        const asset = await prisma.mediaAsset.create({
          data: {
            tenantId: auth.tenantId,
            mimeType: fetched.mimeType,
            byteSize: fetched.bytes.length,
            data: fetched.bytes,
          },
        });
        mediaId = asset.id;
      } catch {
        // Generic error: the fetch path must not reflect upstream statuses
        // (port-scan oracle, audit run-1).
        return res
          .status(400)
          .json(apiError("VALIDATION_ERROR", "Media URL tidak valid atau tidak dapat diambil."));
      }
    }

    // Same find-or-create as inbound: a RESOLVED conversation reopens.
    const { conversation, created } = await findOrCreateConversation(
      auth.tenantId,
      channel.id,
      to
    );

    // Lead source (amendment 2026-11-16): an explicit source always wins and
    // updates the contact. Without one, only a brand-new thread (first contact
    // ever) falls back to the API key's name, then "API" - an existing organic
    // lead keeps its origin. Never blocks the send.
    const fallbackSource =
      auth.kind === "API_KEY" && auth.keyName.trim()
        ? auth.keyName.trim()
        : "API";
    if (source !== undefined || created) {
      await setContactSource({
        tenantId: auth.tenantId,
        phone: to,
        source: source ?? fallbackSource,
        onlyIfEmpty: source === undefined,
      }).catch((err: unknown) => {
        console.error(`[messages] contact source failed for ${to}:`, err);
      });
    }

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

    // Document filename (audit run-2, messages.ts-decode-after-send-integrity):
    // computed BEFORE the send - decodeURIComponent throws on malformed
    // percent-encoding, and doing it after delivery left a sent message with
    // no Message row and no audit entry. try/catch + 120-char clamp (the
    // api-contract cap the URL-basename fallback used to bypass).
    const docFilename =
      mediaId && media?.kind === "document"
        ? (() => {
            const explicit = media.filename?.trim();
            if (explicit) return explicit.slice(0, 120);
            try {
              const base = decodeURIComponent(media.url.split("/").pop() ?? "").split("?")[0];
              return (base || "dokumen").slice(0, 120);
            } catch {
              return "dokumen";
            }
          })()
        : undefined;

    // Web processes hold no socket: the send goes through the worker outbox
    // (same queue as every dashboard reply) with a bounded await.
    const outboxId = await enqueueOutbound({
      tenantId: auth.tenantId,
      channelId: channel.id,
      to,
      ...(text ? { body: text } : {}),
      ...(mediaId ? { mediaId } : {}),
      ...(mediaId && media?.kind === "document" && docFilename
        ? { filename: docFilename }
        : {}),
      source: "REPLY",
    });
    const sendResult = await awaitOutbound(outboxId);
    if (sendResult.status !== "SENT") {
      return res
        .status(502)
        .json(apiError("SEND_FAILED", sendResult.error ?? "Send failed"));
    }

    // Record exactly like a dashboard reply, minus the takeover (PRD 24) -
    // and labelled as an API send so the inbox shows its origin. The
    // filename rides along for document sends - without it the inbox renders
    // the file as a broken image card (PRD 24 amendment, owner bug report
    // 2026-11-19).
    const message = await recordOutboundMessage({
      tenantId: auth.tenantId,
      conversationId: conversation.id,
      senderType: "API",
      ...(auth.kind === "JWT_USER" ? { senderUserId: auth.userId } : {}),
      body: text ?? "",
      waMessageId: sendResult.waMessageId ?? undefined,
      ...(mediaId
        ? { kind: "MEDIA" as const, mediaId, ...(docFilename ? { filename: docFilename } : {}) }
        : {}),
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
