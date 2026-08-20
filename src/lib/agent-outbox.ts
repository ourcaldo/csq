import type { Channel } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/db";
import { getProvider } from "@/lib/whatsapp-provider";
import { logAction } from "@/lib/audit";
import { CLOUD_API_WINDOW_MS } from "@/lib/inbox";

// Shared outbound path for every agent-originated WhatsApp message: the normal
// auto-reply (G7), the approval-result follow-up (G1), the error fallback
// (G5), and the truncated "still processing" message (G6). It enforces the
// Cloud API 24h customer-service window — within the window free-form text is
// allowed; outside the window an approved template is required, and if none is
// configured the send is skipped + audited (this is the Meta-compliant behavior,
// not a shortcut: free-form outside 24h is simply not allowed). Baileys has no
// 24h restriction, so it always sends free-form text.
//
// Records an OUTBOUND/AGENT Message row + an audit entry on every successful
// (or intentionally-skipped) send. Never throws to the caller on send failure
// — returns a result so the agent loop can decide whether to surface it.

export type SendAgentMessageResult = {
  sent: boolean;
  skippedWindow: boolean;
  waMessageId?: string;
  messageId?: string;
};

export type SendAgentMessageInput = {
  channel: Channel;
  conversationId: string;
  customerPhone: string;
  body: string;
  agentId?: string | null;
  // Audit action label, e.g. "conversation.agent_reply",
  // "conversation.approval_approved", "conversation.agent_error".
  action: string;
  // Optional template name to use when outside the 24h window (Cloud API). When
  // unset and outside the window, the send is skipped + audited.
  templateName?: string;
  // Extra audit afterValue payload (e.g. { truncated: true } for G6).
  auditAfter?: Record<string, unknown>;
};

export async function sendAgentMessage(
  input: SendAgentMessageInput
): Promise<SendAgentMessageResult> {
  const { channel, conversationId, customerPhone, body, agentId, action } = input;
  const tenantId = channel.tenantId;
  const provider = getProvider(channel);

  // 24h customer-service window — Cloud API only (FR-MS-003). Baileys bypasses.
  let useTemplate = false;
  let templateToSend: string | undefined;
  if (channel.provider === "CLOUD_API") {
    const lastInbound = await prisma.message.findFirst({
      where: { conversationId, direction: "INBOUND" },
      orderBy: { createdAt: "desc" },
    });
    const withinWindow =
      !!lastInbound &&
      Date.now() - lastInbound.createdAt.getTime() <= CLOUD_API_WINDOW_MS;
    if (!withinWindow) {
      if (input.templateName) {
        useTemplate = true;
        templateToSend = input.templateName;
      } else {
        // No approved template configured and the window is closed: free-form
        // text is not permitted by Meta. Skip the send and audit it so the gap
        // is visible rather than silently dropping the message.
        await logAction({
          tenantId,
          agentId: agentId ?? null,
          action: "conversation.agent_send_skipped_window",
          entityType: "Message",
          entityId: conversationId,
          approvalStatus: "NONE",
          customerPhone,
          afterValue: { reason: "24h window closed and no template configured", body },
        });
        return { sent: false, skippedWindow: true };
      }
    }
  }

  const sendResult = useTemplate && templateToSend
    ? await provider.sendTemplate({
        to: customerPhone,
        templateName: templateToSend,
        languageCode: process.env.WHATSAPP_TEMPLATE_LANG ?? "id",
      })
    : await provider.sendText({ to: customerPhone, body });

  const message = await prisma.message.create({
    data: {
      tenantId,
      conversationId,
      direction: "OUTBOUND",
      senderType: "AGENT",
      senderAgentId: agentId ?? undefined,
      body,
      waMessageId: sendResult.waMessageId,
    },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  });

  await logAction({
    tenantId,
    agentId: agentId ?? null,
    action,
    entityType: "Message",
    entityId: message.id,
    approvalStatus: "NONE",
    customerPhone,
    afterValue: {
      body,
      waMessageId: sendResult.waMessageId,
      ...(input.auditAfter ?? {}),
    },
  });

  return {
    sent: true,
    skippedWindow: false,
    waMessageId: sendResult.waMessageId,
    messageId: message.id,
  };
}

// Resolve the channel for a conversation (used by G1's approval follow-up,
// where we have a conversationId but not a channel in hand). Returns the
// channel only if it is CONNECTED — a disconnected channel must not receive an
// auto-follow-up (matches the agent loop's stand-down rule).
export async function resolveConnectedChannel(
  conversationId: string
): Promise<{ channel: Channel; conversationId: string; customerPhone: string } | null> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { channel: true },
  });
  if (!conv || conv.channel.status !== "CONNECTED") return null;
  return {
    channel: conv.channel,
    conversationId: conv.id,
    customerPhone: conv.customerPhone,
  };
}

// G1: send the approval result back to the customer who asked for it. The
// approval row carries the originating conversationId/customerPhone/agentId
// (stored when the approval was queued in executeTool). Best-effort: if the
// approval predates the routing columns, or the channel is no longer
// connected, skip with a warning — never fail the owner's approve/reject
// action because the follow-up couldn't be delivered.
export async function sendApprovalFollowUp(args: {
  approvalId: string;
  approved: boolean;
}): Promise<void> {
  const approval = await prisma.approval.findUnique({
    where: { id: args.approvalId },
  });
  if (!approval) return;
  if (!approval.conversationId || !approval.customerPhone) {
    console.warn(
      `[approval-followup] approval ${approval.id} has no conversation routing — skipping customer reply`
    );
    return;
  }

  const resolved = await resolveConnectedChannel(approval.conversationId);
  if (!resolved) {
    console.warn(
      `[approval-followup] conversation ${approval.conversationId} channel not connected — skipping customer reply`
    );
    return;
  }

  const body = args.approved
    ? `Pemilik sudah menyetujui permintaan Anda. ${describeApprovalChange(approval.proposedAfter)}`
    : "Maaf, pemilik belum menyetujui permintaan Anda. Ada yang bisa saya bantu lainnya?";

  const templateName = process.env.WHATSAPP_APPROVAL_TEMPLATE || undefined;

  await sendAgentMessage({
    channel: resolved.channel,
    conversationId: resolved.conversationId,
    customerPhone: resolved.customerPhone,
    body,
    agentId: approval.agentId,
    action: args.approved
      ? "conversation.approval_approved"
      : "conversation.approval_rejected",
    templateName,
    auditAfter: { approvalId: approval.id, approved: args.approved },
  });
}

// Render a short, human-readable summary of the approved change from the
// approval's proposedAfter JSON. Keeps the customer message useful without
// leaking internal field names or raw params. Narrows the JsonValue via Zod
// (no `as` casts).
const proposedAfterSchema = z.record(z.unknown());

function describeApprovalChange(proposedAfter: Prisma.JsonValue): string {
  const parsed = proposedAfterSchema.safeParse(proposedAfter);
  if (!parsed.success) return "";
  const obj = parsed.data;
  // Common write shapes carry either a `status` (order.cancel) or a
  // `quantity`/`price` (inventory/product update). Surface at most one.
  if (typeof obj.status === "string") return `Status: ${obj.status}.`;
  if (typeof obj.quantity === "number") return `Stok diperbarui menjadi ${obj.quantity}.`;
  if (typeof obj.price === "string") return `Harga diperbarui menjadi ${obj.price}.`;
  return "";
}

