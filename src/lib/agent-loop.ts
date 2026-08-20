import type { Channel } from "@prisma/client";
import prisma from "@/lib/db";
import { buildSystemPrompt, toChatHistory } from "@/lib/prompt-builder";
import { runConversation } from "@/services/openclaw";
import { sendAgentMessage } from "@/lib/agent-outbox";
import type { ChatMessage, ToolCallRecord } from "@/types/openclaw";

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

export type AgentTurnResult = {
  reply: string;
  toolCalls: ToolCallRecord[];
  truncated?: boolean;
  stoodDown: boolean;
};

// Run one agent turn for a conversation and return what the agent would reply.
// Pure of WhatsApp-side effects (no provider send, no outbound Message row) so
// it can be reused by both the webhook path (which then sends + records) and
// the documented /api/agents/[agentId]/chat.ts endpoint (which just returns
// the reply). Returns `stoodDown: true` when a human owns the conversation or
// no ACTIVE/provisioned agent is configured.
export async function runAgentReply(args: {
  tenantId: string;
  conversationId: string;
  customerPhone: string;
  body: string;
}): Promise<AgentTurnResult> {
  const { tenantId, conversationId, customerPhone, body } = args;

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
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
  // Only an ACTIVE agent with a provisioned OpenClaw cell can reply.
  if (!agent || agent.status !== "ACTIVE" || !agent.openclawAgentId) {
    return { reply: "", toolCalls: [], stoodDown: true };
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    return { reply: "", toolCalls: [], stoodDown: true };
  }

  // Recent message history → OpenAI chat history (INBOUND→user, AGENT
  // outbound→assistant). The current inbound has already been recorded by
  // ingestInboundMessage, so it is the last row in `recent`. We drop that last
  // row from history and pass its body as `userMessage` instead, so
  // runConversation appends exactly one `user` turn for this inbound (no
  // duplicate). If the last row is somehow not the inbound (race), we keep all
  // rows and still pass `body` as the new user turn.
  const recent = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: 30,
  });

  let historyRows = recent;
  let userMessage = body;
  const last = recent[recent.length - 1];
  if (last && last.direction === "INBOUND") {
    historyRows = recent.slice(0, -1);
    userMessage = last.body || body;
  }

  const history: ChatMessage[] = toChatHistory(
    historyRows.map((m) => ({
      direction: m.direction,
      senderType: m.senderType,
      body: m.body,
    }))
  );

  const systemPrompt = await buildSystemPrompt({ tenant, agent });

  const result = await runConversation({
    tenantId,
    agentId: agent.id, // CSQ UUID — keys executeTool/capability lookup
    openclawAgentId: agent.openclawAgentId, // OpenClaw model target (guarded non-null above)
    conversationId,
    channelId: channel.id, // G1: routing context for approval follow-ups
    systemPrompt,
    history,
    userMessage,
    customerPhone,
  });

  return {
    reply: result.reply,
    toolCalls: result.toolCalls,
    truncated: result.truncated,
    stoodDown: false,
  };
}

export async function processInboundWithAgent(args: {
  channel: Channel;
  conversationId: string;
  customerPhone: string;
  body: string;
}): Promise<void> {
  try {
    // G2: serialize turns per conversation across all instances. A
    // transaction-scoped advisory lock on hashtext(conversationId) blocks any
    // other turn for the same conversation (on this or another instance) until
    // this one finishes — preventing duplicate replies and serializing stock
    // mutations. Transaction-scoped locks are safe with PgBouncer transaction
    // pooling (the tx pins one server connection for its lifetime). The lock is
    // held for the whole turn, including OpenClaw HTTP latency, so a generous
    // timeout is required; at UMKM scale holding one pooled connection per
    // active turn is acceptable (a lock table is the documented upgrade path if
    // turn latency grows). Inner DB ops use the global prisma; the lock tx only
    // needs to stay open.
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${args.conversationId})::bigint)`;
        await processInboundWithAgentInner(args);
      },
      { timeout: 120_000, maxWait: 10_000 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(
      `[agent-loop] Failed to process inbound for conversation ${args.conversationId}: ${message}`
    );
    // G5: don't leave the customer in silence when the agent errors (OpenClaw
    // down, send failure, etc.). Best-effort canned fallback — the 24h window
    // is open because the inbound that triggered this turn just arrived. Guarded
    // so a second failure here can never throw out of this catch.
    try {
      await sendAgentMessage({
        channel: args.channel,
        conversationId: args.conversationId,
        customerPhone: args.customerPhone,
        body:
          "Maaf, sistem kami sedang mengalami gangguan sebentar. Pesan Anda akan kami balas secepatnya.",
        action: "conversation.agent_error",
        templateName: process.env.WHATSAPP_AGENT_FALLBACK_TEMPLATE || undefined,
        auditAfter: { error: message },
      });
    } catch (sendErr) {
      const sendMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
      console.error(
        `[agent-loop] fallback send also failed for conversation ${args.conversationId}: ${sendMsg}`
      );
    }
  }
}

async function processInboundWithAgentInner(args: {
  channel: Channel;
  conversationId: string;
  customerPhone: string;
  body: string;
}): Promise<void> {
  const { channel, conversationId, customerPhone, body } = args;
  const tenantId = channel.tenantId;

  const turn = await runAgentReply({
    tenantId,
    conversationId,
    customerPhone,
    body,
  });

  if (turn.stoodDown) return;

  // G6: a truncated turn (iteration cap hit) may carry empty or mid-thought
  // content. Send a clean "still processing" message instead of a partial
  // reply, so the customer is never left hanging or handed a half-finished
  // answer. A non-truncated empty reply means the model had nothing to say —
  // nothing to send.
  let replyBody = turn.reply;
  if (turn.truncated) {
    replyBody =
      "Mohon tunggu, saya sedang memproses permintaan Anda dan akan segera membalas.";
  }
  if (!replyBody.trim()) return;

  // Resolve which agent replied (per-conversation assignment or channel default)
  // so the outbound Message and audit log are attributed correctly.
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
  });
  const agentId = conversation?.assignedAgentId ?? channel.agentId;

  // Reload the channel — if the owner disconnected (Putuskan) while the turn
  // was running, don't send the reply.
  const freshChannel = await prisma.channel.findUnique({
    where: { id: channel.id },
  });
  if (!freshChannel || freshChannel.status !== "CONNECTED") return;

  // G7: send via the shared agent-outbox, which enforces the 24h
  // customer-service window (free-form within, template outside) and records
  // the OUTBOUND/AGENT Message + audit. The fallback template is used only
  // if the turn ran so long the window closed mid-flight.
  await sendAgentMessage({
    channel: freshChannel,
    conversationId,
    customerPhone,
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
