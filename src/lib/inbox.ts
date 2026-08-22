import { Prisma } from "@prisma/client";
import type { Conversation, Message } from "@prisma/client";
import prisma from "@/lib/db";
import { HttpError } from "@/lib/queries";
import { logAction } from "@/lib/audit";
import { getProvider } from "@/lib/whatsapp-provider";
import type { InboundMessage } from "@/types/whatsapp";
import { events } from "@/lib/events";

// Inbox domain logic shared by the dashboard routes and the webhook ingest
// path (SDD §4.9). Tenant is always passed explicitly — never inferred from
// message content.

// 24h customer-service window for Cloud API free-form replies (FR-MS-003).
// Baileys has no such restriction. Shared with src/lib/agent-outbox.ts.
export const CLOUD_API_WINDOW_MS = 24 * 60 * 60 * 1000;

// Upsert Contact (tenantId+phone unique) and Conversation
// (tenantId+channelId+phone unique), then stamp lastMessageAt. Returns the
// conversation row + whether it was newly created (so callers can fire a
// `conversation.new` scenario trigger only on the first inbound, not on every
// subsequent message to an existing thread). Race-safe: if two first-messages
// arrive concurrently, the unique constraint makes one create fail P2002 and
// fall through to an update as existing. Used by the webhook for inbound and
// by sendHumanReply for outbound (both bump lastMessageAt).
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
      tenantId_channelId_customerPhone: { tenantId, channelId, customerPhone },
    },
  });
  if (existing) {
    const conversation = await prisma.conversation.update({
      where: { id: existing.id },
      data: { lastMessageAt: new Date(), contactId: contact.id },
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
    // Raced with another first-message for the same customer+channel: the
    // unique constraint fired. Treat as existing — update and report created=false.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const conversation = await prisma.conversation.update({
        where: {
          tenantId_channelId_customerPhone: { tenantId, channelId, customerPhone },
        },
        data: { lastMessageAt: new Date(), contactId: contact.id },
      });
      return { conversation, created: false };
    }
    throw err;
  }
}

// Shared inbound ingest path (SDD §4.9 / phase 7.4). Both the Cloud API
// webhook and the Baileys socket call this. channelId/tenantId come from the
// resolved channel — never from message content. On a brand-new conversation
// (first inbound from this customer) it emits `conversation.new` so any active
// ON_NEW_CONVERSATION scenarios can start a run — fire-and-forget, never
// blocks the ingest/ACK path.
export async function ingestInboundMessage(msg: InboundMessage): Promise<Message> {
  const { conversation, created } = await findOrCreateConversation(
    msg.tenantId,
    msg.channelId,
    msg.from
  );
  const message = await recordInboundMessage({
    tenantId: msg.tenantId,
    conversationId: conversation.id,
    from: msg.from,
    body: msg.body,
    waMessageId: msg.waMessageId,
    receivedAt: msg.receivedAt,
    customerName: msg.customerName,
  });

  if (created) {
    events.emit("conversation.new", {
      tenantId: msg.tenantId,
      conversationId: conversation.id,
      channelId: msg.channelId,
      customerPhone: msg.from,
      customerName: msg.customerName,
    });
  }

  return message;
}

// Persist an inbound customer message. direction=INBOUND, senderType=CUSTOMER.
// `receivedAt` is the WhatsApp timestamp (not server now()) so the inbox shows
// the real message time.
export async function recordInboundMessage(input: {
  tenantId: string;
  conversationId: string;
  from: string;
  body: string;
  waMessageId: string;
  receivedAt: Date;
  customerName?: string;
}): Promise<Message> {
  const message = await prisma.message.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      direction: "INBOUND",
      senderType: "CUSTOMER",
      body: input.body,
      waMessageId: input.waMessageId,
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

  return message;
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

  // 24h customer-service window — Cloud API only (FR-MS-003).
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

  const provider = getProvider(conv.channel);
  const result = await provider.sendText({ to: conv.customerPhone, body: input.body });

  const message = await recordOutboundMessage({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    senderUserId: input.userId,
    body: input.body,
    waMessageId: result.waMessageId,
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

  return message;
}
