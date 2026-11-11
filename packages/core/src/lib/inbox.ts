import { Prisma } from "@prisma/client";
import type { Conversation, Message } from "@prisma/client";
import prisma from "@csq/core/lib/db";
import { HttpError } from "@csq/core/lib/queries";
import { logAction } from "@csq/core/lib/audit";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { enqueueOutbound, awaitOutbound } from "@csq/core/lib/outbox";
import type { InboundMessage, InboundKind } from "@csq/core/types/whatsapp";
import { events } from "@csq/core/lib/events";

// Inbox domain logic shared by the dashboard routes and the webhook ingest
// path (SDD §4.9). Tenant is always passed explicitly - never inferred from
// message content.

// 24h customer-service window for Cloud API free-form replies (FR-MS-003).
// Baileys has no such restriction. Shared with src/lib/agent-outbox.ts.
export const CLOUD_API_WINDOW_MS = 24 * 60 * 60 * 1000;

// Upsert Contact (tenantId+phone unique) and Conversation (tenantId+phone
// unique - ONE thread per customer identity, across channels: the thread
// follows the channel of the latest inbound), then stamp lastMessageAt.
// Returns the conversation row + whether it was newly created (so callers can
// fire a `conversation.new` scenario trigger only on the first inbound, not on
// every subsequent message to an existing thread). Race-safe: if two
// first-messages arrive concurrently, the unique constraint makes one create
// fail P2002 and fall through to an update as existing. Used by the webhook
// for inbound, the campaign engine, and sendHumanReply for outbound (all bump
// lastMessageAt).
export async function findOrCreateConversation(
  tenantId: string,
  channelId: string,
  customerPhone: string
): Promise<{ conversation: Conversation; created: boolean }> {
  const contact = await prisma.contact.upsert({
    where: { tenantId_phone: { tenantId, phone: customerPhone } },
    update: {},
    create: { tenantId, phone: customerPhone },
  });

  const existing = await prisma.conversation.findUnique({
    where: {
      tenantId_customerPhone: { tenantId, customerPhone },
    },
  });
  if (existing) {
    const conversation = await prisma.conversation.update({
      where: { id: existing.id },
      data: {
        lastMessageAt: new Date(),
        contactId: contact.id,
        // The customer may write on a different number (Pribadi <-> Resmi):
        // the thread follows the channel of the LATEST message so replies go
        // out the channel they last used.
        channelId,
        // Auto session close (PRD 03 amendment 2026-11-11) may have RESOLVED
        // this chat; a new customer message reopens it. PENDING is a human
        // judgment and stays untouched.
        ...(existing.status === "RESOLVED" ? { status: "OPEN" } : {}),
      },
    });
    return { conversation, created: false };
  }

  try {
    const conversation = await prisma.conversation.create({
      data: {
        tenantId,
        channelId,
        customerPhone,
        contactId: contact.id,
        lastMessageAt: new Date(),
      },
    });
    return { conversation, created: true };
  } catch (err) {
    // Raced with another first-message for the same customer: the unique
    // constraint fired. Treat as existing - update and report created=false.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const conversation = await prisma.conversation.update({
        where: {
          tenantId_customerPhone: { tenantId, customerPhone },
        },
        data: { lastMessageAt: new Date(), contactId: contact.id, channelId },
      });
      return { conversation, created: false };
    }
    throw err;
  }
}

// Shared inbound ingest path (SDD §4.9 / phase 7.4). Both the Cloud API
// webhook and the Baileys socket call this. channelId/tenantId come from the
// resolved channel - never from message content. On a brand-new conversation
// (first inbound from this customer) it emits `conversation.new` so any active
// ON_NEW_CONVERSATION scenarios can start a run - fire-and-forget, never
// blocks the ingest/ACK path.
//
// D3: idempotent. Message carries a partial unique index on
// (tenantId, waMessageId), so a Meta redelivery cannot store a second row;
// the caller is told it was a duplicate and must skip the agent turn.
export type IngestedInbound = {
  message: Message;
  conversationId: string;
  // True when this waMessageId was already stored (provider redelivery).
  duplicate: boolean;
};

export async function ingestInboundMessage(
  msg: InboundMessage
): Promise<IngestedInbound> {
  // RLS context (PRD 16 SEC-1): every write below is msg.tenantId's data.
  // Called from the webhook (which also holds the context) and from the
  // Baileys runtime (which does not) - entering it here covers both.
  return withTenantContext(msg.tenantId, async () => {
    const { conversation, created } = await findOrCreateConversation(
      msg.tenantId,
      msg.channelId,
      msg.from
    );
    const { message, duplicate } = await recordInboundMessage({
      tenantId: msg.tenantId,
      conversationId: conversation.id,
      from: msg.from,
      body: msg.body,
      kind: msg.kind,
      waMessageId: msg.waMessageId,
      receivedAt: msg.receivedAt,
      customerName: msg.customerName,
      // Media bytes MUST cross this boundary: recordInboundMessage stores
      // them as a MediaAsset and links Message.mediaId. Dropping them here
      // was why inbound photos rendered as "[image]".
      ...(msg.media ? { media: msg.media } : {}),
    });

    // The trigger fires only for a genuinely new message on a genuinely new
    // conversation - a redelivery must never start a second scenario run.
    if (created && !duplicate) {
      events.conversationNew.emit({
        tenantId: msg.tenantId,
        conversationId: conversation.id,
        channelId: msg.channelId,
        customerPhone: msg.from,
        customerName: msg.customerName,
      });
    }

    return { message, conversationId: conversation.id, duplicate };
  });
}

// Persist an inbound customer message. direction=INBOUND, senderType=CUSTOMER.
// `receivedAt` is the WhatsApp timestamp (not server now()) so the inbox shows
// the real message time. D3: returns { duplicate: true } with the already
// stored row when the (tenantId, waMessageId) unique index rejects a
// redelivery instead of throwing.
export async function recordInboundMessage(input: {
  tenantId: string;
  conversationId: string;
  from: string;
  body: string;
  kind: InboundKind;
  waMessageId: string;
  receivedAt: Date;
  customerName?: string;
  media?: { bytes: Buffer; mimeType: string };
}): Promise<{ message: Message; duplicate: boolean }> {
  try {
    // Inbound image bytes become a MediaAsset; the Message links it via
    // mediaId so the inbox renders the photo. A failed download keeps the
    // "[image]" placeholder body.
    let mediaId: string | null = null;
    if (input.media) {
      const asset = await prisma.mediaAsset.create({
        data: {
          tenantId: input.tenantId,
          mimeType: input.media.mimeType,
          byteSize: input.media.bytes.length,
          data: input.media.bytes,
        },
      });
      mediaId = asset.id;
    }
    const body = input.body || (mediaId ? "" : "[image]");
    const message = await prisma.message.create({
      data: {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        body,
        // Map the lowercase wire form onto the Prisma enum (no string→enum cast).
        kind:
          input.kind === "text"
            ? "TEXT"
            : input.kind === "media"
              ? "MEDIA"
              : "OTHER",
        waMessageId: input.waMessageId,
        mediaId,
        createdAt: input.receivedAt,
      },
    });

    // If the contact has no name yet, fill it from the inbound payload.
    if (input.customerName) {
      await prisma.contact.updateMany({
        where: { tenantId: input.tenantId, phone: input.from, name: null },
        data: { name: input.customerName },
      });
    }

    return { message, duplicate: false };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const existing = await prisma.message.findFirst({
        where: { tenantId: input.tenantId, waMessageId: input.waMessageId },
        orderBy: { createdAt: "asc" },
      });
      if (existing) return { message: existing, duplicate: true };
    }
    throw err;
  }
}

// Persist an outbound message sent by a human (dashboard reply). Caller is
// responsible for actually sending via the provider; this only records it.
export async function recordOutboundMessage(input: {
  tenantId: string;
  conversationId: string;
  senderUserId: string;
  body: string;
  waMessageId?: string;
  isInternal?: boolean;
}): Promise<Message> {
  return prisma.message.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      direction: "OUTBOUND",
      senderType: "HUMAN",
      senderUserId: input.senderUserId,
      body: input.body,
      waMessageId: input.waMessageId,
      isInternal: input.isInternal ?? false,
    },
  });
}

// Assign a conversation to an agent OR a human user, enforcing the
// assignedAgentId XOR assigneeUserId invariant (one or the other, not both).
// Assigning to a human stands the AI down (FR-AS-003, FR-HD-001). Passing
// both null clears the assignment. Passing both non-null throws.
export async function assignConversation(
  conversationId: string,
  tenantId: string,
  assignment: { agentId?: string | null; userId?: string | null }
): Promise<Conversation> {
  const { agentId, userId } = assignment;
  if (agentId && userId) {
    throw new HttpError(
      "VALIDATION_ERROR",
      "Tetapkan ke agent atau user, tidak keduanya."
    );
  }

  const existing = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
  });
  if (!existing) {
    throw new HttpError("NOT_FOUND", "Percakapan tidak ditemukan.");
  }

  const data: Prisma.ConversationUpdateInput = {};
  if (agentId !== undefined) {
    data.assignedAgent = agentId ? { connect: { id: agentId } } : { disconnect: true };
    data.assignee = { disconnect: true };
  }
  if (userId !== undefined) {
    data.assignee = userId ? { connect: { id: userId } } : { disconnect: true };
    data.assignedAgent = { disconnect: true };
  }

  const conv = await prisma.conversation.update({
    where: { id: conversationId },
    data,
  });

  await logAction({
    tenantId,
    agentId: conv.assignedAgentId,
    action: "conversation.assign",
    entityType: "Conversation",
    entityId: conversationId,
    approvalStatus: "NONE",
    customerPhone: conv.customerPhone,
    afterValue: {
      assignedAgentId: conv.assignedAgentId,
      assigneeUserId: conv.assigneeUserId,
    },
  });

  return conv;
}

// Send a human reply from the inbox: enforce the 24h window for Cloud API,
// send via the channel's provider, persist the outbound Message, and audit.
export async function sendHumanReply(input: {
  conversationId: string;
  tenantId: string;
  userId: string;
  body: string;
}): Promise<Message> {
  const conv = await prisma.conversation.findFirst({
    where: { id: input.conversationId, tenantId: input.tenantId },
    include: { channel: true },
  });
  if (!conv) {
    throw new HttpError("NOT_FOUND", "Percakapan tidak ditemukan.");
  }

  // 24h customer-service window - Cloud API only (FR-MS-003).
  if (conv.channel.provider === "CLOUD_API") {
    const lastInbound = await prisma.message.findFirst({
      where: { conversationId: input.conversationId, direction: "INBOUND" },
      orderBy: { createdAt: "desc" },
    });
    const withinWindow =
      !!lastInbound &&
      Date.now() - lastInbound.createdAt.getTime() <= CLOUD_API_WINDOW_MS;
    if (!withinWindow) {
      throw new HttpError(
        "VALIDATION_ERROR",
        "Jendela 24 jam telah tutup. Gunakan template yang disetujui untuk pesan proaktif."
      );
    }
  }

  // Phase 6: the dashboard holds no socket - the send goes through the
  // worker's outbox. The bounded await keeps this function's old
  // synchronous contract: throw on failure, Message row only on success.
  const outboxId = await enqueueOutbound({
    tenantId: input.tenantId,
    channelId: conv.channel.id,
    to: conv.customerPhone,
    body: input.body,
    source: "REPLY",
  });
  const result = await awaitOutbound(outboxId);
  if (result.status !== "SENT") {
    throw new HttpError("INTERNAL_ERROR", result.error ?? "Gagal mengirim balasan.");
  }

  const message = await recordOutboundMessage({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    senderUserId: input.userId,
    body: input.body,
    waMessageId: result.waMessageId ?? undefined,
  });

  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: { lastMessageAt: new Date() },
  });

  // Minimal audit row for human outbound (full audit layer is Phase 5).
  await logAction({
    tenantId: input.tenantId,
    agentId: null,
    action: "conversation.human_reply",
    entityType: "Message",
    entityId: message.id,
    approvalStatus: "NONE",
    customerPhone: conv.customerPhone,
    afterValue: { body: input.body, waMessageId: result.waMessageId },
  });

  // Reply-as-takeover (PRD 03 amendment 2026-11-10): a customer-facing human
  // reply makes the replier own the conversation - the AI stands down from
  // now on instead of auto-answering on top of the human. Reassignment via
  // assignConversation keeps the XOR invariant and writes the audit row.
  if (conv.assigneeUserId !== input.userId) {
    await assignConversation(input.conversationId, input.tenantId, {
      userId: input.userId,
    });
  }

  return message;
}
