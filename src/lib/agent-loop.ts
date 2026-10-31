import type { Channel } from "@prisma/client";
import prisma from "@/lib/db";
import { buildSystemPrompt } from "@/lib/prompt-builder";
import { runConversation } from "@/services/llm-runtime";
import { sendAgentMessage } from "@/lib/agent-outbox";
import { acquireTurnLease, releaseTurnLease } from "@/lib/turn-lock";
import type { ChatMessage, ToolCallRecord } from "@/types/chat";

// Fire-and-forget agent auto-reply for an inbound WhatsApp message — the
// Phase 6 ↔ Phase 7 wiring. Called from the webhook AFTER the inbound is
// recorded, NOT awaited, so Meta's 5s webhook timeout is never at risk. The
// ACK is sent by the caller before this work finishes.
//
// Resolution order for which agent replies:
//   1. conversation.assignedAgentId  — an explicit per-conversation assignment
//   2. channel.agentId               — the channel's default agent
// If the conversation is assigned to a human (assigneeUserId), the AI stands
// down (FR-AS-003): a human is handling it, so we do not auto-reply.
//
// Tenant always comes from the resolved channel — never from message content.
// All failures are caught and logged: a broken agent reply must never surface
// as an error to Meta (which would retry and spam the customer).
//
// D1 — turn serialization. Turns are serialized per conversation with a LEASE
// on the Conversation row (src/lib/turn-lock.ts), NOT with a held Postgres
// transaction. No pooled connection is pinned while the agent waits on the
// LLM, and a turn that outlives the lease's stale window (crashed process)
// is automatically recoverable. When the lease is busy we simply return: the
// in-flight turn's drain loop picks the new message up as an unanswered
// inbound when it finishes, so no message is ever dropped by the skip.

export type AgentTurnResult = {
  reply: string;
  toolCalls: ToolCallRecord[];
  truncated?: boolean;
  stoodDown: boolean;
};

// Run one agent turn for a conversation and return what the agent would reply.
// Pure of WhatsApp-side effects (no provider send, no outbound Message row) so
// it can be reused by the webhook path (which then sends + records). Returns
// `stoodDown: true` when a human owns the conversation or no ACTIVE/provisioned
// agent is configured.
export async function runAgentReply(args: {
  tenantId: string;
  conversationId: string;
  customerPhone: string;
  body: string;
}): Promise<AgentTurnResult> {
  const { tenantId, conversationId, customerPhone, body } = args;

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: { deal: { include: { stage: true } } },
  });
  if (!conversation) {
    return { reply: "", toolCalls: [], stoodDown: true };
  }

  // Human owns the conversation → AI stands down (FR-AS-003).
  if (conversation.assigneeUserId) {
    return { reply: "", toolCalls: [], stoodDown: true };
  }

  // Resolve the replying agent: per-conversation assignment, else the channel's
  // default agent. The channel row is loaded explicitly (no relation include).
  const channel = await prisma.channel.findUnique({
    where: { id: conversation.channelId },
  });
  // Don't run the AI on a channel that's been disconnected (e.g. owner clicked
  // Putuskan while the inbound was in-flight). Standing down here prevents a
  // reply from going out after disconnect.
  if (!channel || channel.status !== "CONNECTED") {
    return { reply: "", toolCalls: [], stoodDown: true };
  }
  const resolvedAgentId = conversation.assignedAgentId ?? channel?.agentId;
  if (!resolvedAgentId) {
    return { reply: "", toolCalls: [], stoodDown: true };
  }

  const agent = await prisma.agent.findFirst({
    where: { id: resolvedAgentId, tenantId },
  });
  // Only an ACTIVE agent can reply.
  if (!agent || agent.status !== "ACTIVE") {
    return { reply: "", toolCalls: [], stoodDown: true };
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    return { reply: "", toolCalls: [], stoodDown: true };
  }

  // BOUNDED HISTORY WINDOW (no external session state). The recent transcript
  // is replayed from our own Message rows, capped to the newest
  // AGENT_HISTORY_LIMIT messages within the 1h window — a chat that goes
  // quiet for an hour starts a fresh window, so stale/incorrect facts cannot
  // leak across windows and the prompt stays bounded. Continuity beyond the
  // window lives in the CSQ layer the agent pulls via tools on every fresh
  // window: customer.read (name/email), order.list (history), pipeline stage.
  const SESSION_TTL_MS = 60 * 60 * 1000;
  const AGENT_HISTORY_LIMIT = 20;
  const windowStart = new Date(Date.now() - SESSION_TTL_MS);
  const recentRows = await prisma.message.findMany({
    where: {
      conversationId,
      createdAt: { gte: windowStart },
      isInternal: false,
    },
    orderBy: { createdAt: "asc" },
    take: AGENT_HISTORY_LIMIT,
    select: { direction: true, body: true },
  });
  // Oldest-first rows → OpenAI chat messages. INBOUND → user; anything the
  // agent or a human sent outbound → assistant.
  const history: ChatMessage[] = recentRows.map((m) => ({
    role: m.direction === "INBOUND" ? "user" : "assistant",
    content: m.body,
  }));
  const isStartOfNewWindow = history.length === 0;

  // Fresh-window opener: one bounded line of safe structured facts
  // from CSQ so the agent doesn't ask the customer things the system already
  // knows. NOT a replay — a short summary pulled from the source of truth.
  let windowContext = "";
  if (isStartOfNewWindow) {
    // The conversation row is already loaded with deal+stage included, so the
    // current stage name needs no extra query.
    const stageName = conversation.deal?.stage?.name ?? null;
    const [contact, orderCount, lastOrder] = await Promise.all([
      prisma.contact.findFirst({
        where: { tenantId, phone: customerPhone },
        select: { name: true, email: true },
      }),
      prisma.order.count({ where: { tenantId, customerPhone } }),
      prisma.order.findFirst({
        where: { tenantId, customerPhone },
        orderBy: { createdAt: "desc" },
        select: { totalAmount: true, createdAt: true, status: true },
      }),
    ]);
    const parts = [
      contact?.name ? `Nama pelanggan tercatat: ${contact.name}` : null,
      contact?.email ? `Email tercatat: ${contact.email}` : null,
      orderCount > 0
        ? `${orderCount} order sebelumnya (terakhir: ${new Date(
            lastOrder!.createdAt
          ).toLocaleDateString("id-ID")}, ${lastOrder!.status}, Rp ${lastOrder!.totalAmount})`
        : null,
      stageName ? `Tahap pipeline saat ini: ${stageName}` : null,
    ].filter(Boolean);
    if (parts.length > 0) {
      windowContext = `[Konteks pelanggan dari sistem] ${parts.join("; ")}. Verifikasi detail dengan tools bila perlu.\n\n`;
    }
  }

  // Map the Prisma conversation's deal+stage into the minimal prompt context.
  const stage = conversation.deal?.stage;
  const systemPrompt = await buildSystemPrompt({
    tenant,
    agent,
    conversation: stage
      ? { deal: { stage: { name: stage.name, kind: stage.kind } } }
      : undefined,
  });

  const result = await runConversation({
    tenantId,
    agentId: agent.id, // CSQ UUID — keys executeTool/capability lookup
    conversationId,
    channelId: channel.id, // G1: routing context for approval follow-ups
    systemPrompt,
    history, // bounded 1h-window transcript (see above)
    userMessage: windowContext + body,
    customerPhone,
  });

  return {
    reply: result.reply,
    toolCalls: result.toolCalls,
    truncated: result.truncated,
    stoodDown: false,
  };
}

// A drain pass may answer at most this many queued inbounds. The cap exists so
// a pathological loop (model replies with nothing, next inbound still
// unanswered) terminates; each pass answers one message.
const MAX_DRAIN_TURNS = 3;

export async function processInboundWithAgent(args: {
  channel: Channel;
  conversationId: string;
}): Promise<void> {
  const { channel, conversationId } = args;
  const tenantId = channel.tenantId;

  const leaseId = await acquireTurnLease(conversationId, tenantId);
  if (!leaseId) {
    // Another turn holds this conversation. Returning (instead of waiting) is
    // the whole point: no connection pinned, and the holder's drain loop will
    // pick this message up as an unanswered inbound when it finishes.
    return;
  }

  try {
    await drainUnansweredInbound(channel, conversationId, tenantId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(
      `[agent-loop] Failed to process inbound for conversation ${conversationId}: ${message}`
    );
    // G5: don't leave the customer in silence when the agent errors (LLM
    // down, send failure, etc.). Best-effort canned fallback — the 24h window
    // is open because the inbound that triggered this turn just arrived. Guarded
    // so a second failure here can never throw out of this catch.
    try {
      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, tenantId },
      });
      if (!conversation) return;
      await sendAgentMessage({
        channel,
        conversationId,
        customerPhone: conversation.customerPhone,
        body:
          "Maaf, sistem kami sedang mengalami gangguan sebentar. Pesan Anda akan kami balas secepatnya.",
        action: "conversation.agent_error",
        templateName: process.env.WHATSAPP_AGENT_FALLBACK_TEMPLATE || undefined,
        auditAfter: { error: message },
      });
    } catch (sendErr) {
      const sendMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
      console.error(
        `[agent-loop] fallback send also failed for conversation ${conversationId}: ${sendMsg}`
      );
    }
  } finally {
    await releaseTurnLease(conversationId, tenantId, leaseId).catch((err: unknown) => {
      console.error(
        `[agent-loop] lease release failed for conversation ${conversationId}:`,
        err
      );
    });
  }
}

// Answer every unanswered inbound on the conversation, newest-first, until
// none remain (or the cap is hit). This is what makes "skip when the lease
// is busy" safe: the in-flight turn re-checks after finishing, so a message
// that arrived mid-turn is still answered by the lease holder.
async function drainUnansweredInbound(
  channel: Channel,
  conversationId: string,
  tenantId: string
): Promise<void> {
  const attempted = new Set<string>();

  for (let i = 0; i < MAX_DRAIN_TURNS; i++) {
    // Newest inbound that has no business-side reply after it. Only AGENT or
    // HUMAN outbound counts as an answer — a SCENARIO message (opening
    // greeting, promo) must never mark a customer's question as answered.
    const trigger = await prisma.message.findFirst({
      where: { conversationId, tenantId, direction: "INBOUND" },
      orderBy: { createdAt: "desc" },
    });
    if (!trigger || attempted.has(trigger.id)) return;
    attempted.add(trigger.id);

    const answered = await prisma.message.findFirst({
      where: {
        conversationId,
        tenantId,
        direction: "OUTBOUND",
        senderType: { in: ["AGENT", "HUMAN"] },
        createdAt: { gte: trigger.createdAt },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (answered) return;

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });
    if (!conversation) return;

    const turn = await runAgentReply({
      tenantId,
      conversationId,
      customerPhone: conversation.customerPhone,
      body: trigger.body,
    });
    if (turn.stoodDown) return;

    // G6: a truncated turn (iteration cap / budget hit) may carry empty or
    // mid-thought content. Send a clean "still processing" message instead of
    // a partial reply, so the customer is never left hanging or handed a
    // half-finished answer. A non-truncated empty reply means the model had
    // nothing to say — nothing to send, and the drain stops on `attempted`.
    let replyBody = turn.reply;
    if (turn.truncated) {
      replyBody =
        "Mohon tunggu, saya sedang memproses permintaan Anda dan akan segera membalas.";
    }
    if (!replyBody.trim()) continue;

    // Reload the channel — if the owner disconnected (Putuskan) while the turn
    // was running, don't send the reply.
    const freshChannel = await prisma.channel.findUnique({
      where: { id: channel.id },
    });
    if (!freshChannel || freshChannel.status !== "CONNECTED") return;

    const agentId = conversation.assignedAgentId ?? freshChannel.agentId;

    // G7: send via the shared agent-outbox, which enforces the 24h
    // customer-service window (free-form within, template outside) and records
    // the OUTBOUND/AGENT Message + audit. The fallback template is used only
    // if the turn ran so long the window closed mid-flight.
    await sendAgentMessage({
      channel: freshChannel,
      conversationId,
      customerPhone: conversation.customerPhone,
      body: replyBody,
      agentId: agentId ?? null,
      action: "conversation.agent_reply",
      templateName: process.env.WHATSAPP_AGENT_FALLBACK_TEMPLATE || undefined,
      auditAfter: {
        toolCalls: turn.toolCalls.length,
        truncated: turn.truncated ?? false,
      },
    });
  }
}
