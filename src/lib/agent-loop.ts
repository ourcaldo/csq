import type { Channel } from "@prisma/client";
import prisma from "@/lib/db";
import { getProvider } from "@/lib/whatsapp-provider";
import { buildSystemPrompt, toChatHistory } from "@/lib/prompt-builder";
import { runConversation } from "@/services/openclaw";
import { logAction } from "@/lib/audit";
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
    await processInboundWithAgentInner(args);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(
      `[agent-loop] Failed to process inbound for conversation ${args.conversationId}: ${message}`
    );
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

  if (turn.stoodDown || !turn.reply.trim()) return;

  // Resolve which agent replied (per-conversation assignment or channel default)
  // so the outbound Message and audit log are attributed correctly.
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
  });
  const agentId = conversation?.assignedAgentId ?? channel.agentId;

  // Send the reply via the channel's provider (Cloud API or Baileys) and
  // record it as an AGENT outbound message. This auto-reply is always in
  // direct response to a fresh inbound, so the Cloud API 24h window is open.
  // Reload the channel first — if the owner disconnected (Putuskan) while
  // the turn was running, don't send the reply.
  const freshChannel = await prisma.channel.findUnique({
    where: { id: channel.id },
  });
  if (!freshChannel || freshChannel.status !== "CONNECTED") return;

  const provider = getProvider(freshChannel);
  const sendResult = await provider.sendText({
    to: customerPhone,
    body: turn.reply,
  });

  const message = await prisma.message.create({
    data: {
      tenantId,
      conversationId,
      direction: "OUTBOUND",
      senderType: "AGENT",
      senderAgentId: agentId ?? undefined,
      body: turn.reply,
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
    action: "conversation.agent_reply",
    entityType: "Message",
    entityId: message.id,
    approvalStatus: "NONE",
    customerPhone,
    afterValue: {
      body: turn.reply,
      waMessageId: sendResult.waMessageId,
      toolCalls: turn.toolCalls.length,
      truncated: turn.truncated ?? false,
    },
  });
}
