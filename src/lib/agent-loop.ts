import type { Channel } from "@prisma/client";
import prisma from "@/lib/db";
import { buildSystemPrompt } from "@/lib/prompt-builder";
import { runConversation } from "@/services/openclaw";
import { sendAgentMessage } from "@/lib/agent-outbox";
import type { ToolCallRecord } from "@/types/openclaw";

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
  // Only an ACTIVE agent with a provisioned OpenClaw cell can reply.
  if (!agent || agent.status !== "ACTIVE" || !agent.openclawAgentId) {
    return { reply: "", toolCalls: [], stoodDown: true };
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    return { reply: "", toolCalls: [], stoodDown: true };
  }

  // SESSION-BASED CONTEXT (no history replay). The OpenClaw session keyed by
  // the session key below persists the full transcript of the active window —
  // including assistant replies and tool-call results, which a CSQ-side replay
  // could never reconstruct — and OpenClaw compacts it internally. CSQ sends
  // ONLY the new user message; replaying stored rows on top would double-keep
  // state (and the old implementation's asc+take window sent stale rows).
  //
  // TTL: one session window per conversation, 1h since the LAST inbound. A
  // chat that goes quiet for an hour starts a fresh window — stale/incorrect
  // facts cannot leak across windows. Continuity beyond the window lives in
  // the CSQ layer the agent pulls via tools on every fresh window:
  // customer.read (name/email), order.list (history), pipeline stage.
  const lastInbound = await prisma.message.findFirst({
    where: { conversationId, direction: "INBOUND" },
    orderBy: { createdAt: "desc" },
  });
  const SESSION_TTL_MS = 60 * 60 * 1000;
  const currentInboundAt = new Date();
  const isStartOfNewWindow =
    !lastInbound ||
    currentInboundAt.getTime() - lastInbound.createdAt.getTime() > SESSION_TTL_MS;
  // <conversationId>#w<windowStartEpoch> — each window gets its own OpenClaw
  // session; the id prefix keeps the OpenClaw UI grouping readable.
  const sessionKey = `${conversationId}#w${Math.floor(
    (lastInbound && !isStartOfNewWindow
      ? lastInbound.createdAt
      : currentInboundAt
    ).getTime() /
      SESSION_TTL_MS
  )}`;

  // Fresh-window opener (option b): one bounded line of safe structured facts
  // from CSQ so the agent doesn't ask the customer things the system already
  // knows. NOT a replay — a short summary pulled from the source of truth.
  let windowContext = "";
  if (isStartOfNewWindow) {
    const [contact, orderCount, lastOrder, stage] = await Promise.all([
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
      prisma.conversation
        .findUnique({
          where: { id: conversationId },
          select: { deal: { select: { stage: { select: { name: true } } } } },
        })
        .then((c) => c?.deal?.stage?.name ?? null),
    ]);
    const parts = [
      contact?.name ? `Nama pelanggan tercatat: ${contact.name}` : null,
      contact?.email ? `Email tercatat: ${contact.email}` : null,
      orderCount > 0
        ? `${orderCount} order sebelumnya (terakhir: ${new Date(
            lastOrder!.createdAt
          ).toLocaleDateString("id-ID")}, ${lastOrder!.status}, Rp ${lastOrder!.totalAmount})`
        : null,
      stage ? `Tahap pipeline saat ini: ${stage}` : null,
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
    openclawAgentId: agent.openclawAgentId, // OpenClaw model target (guarded non-null above)
    conversationId,
    // Session-based context: the OpenClaw session key selects the 1h window
    // (see above); history is NOT replayed.
    sessionKey,
    channelId: channel.id, // G1: routing context for approval follow-ups
    systemPrompt,
    history: [], // windowContext (if any) is folded into userMessage below
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
