import type { Channel } from "@prisma/client";
import { randomUUID } from "crypto";
import { z } from "zod";
import prisma from "@csq/core/lib/db";
import { buildSystemPrompt } from "@csq/core/lib/prompt-builder";
import { runConversation } from "@csq/core/services/llm-runtime";
import { sendAgentMessage } from "@csq/core/lib/agent-outbox";
import { acquireTurnLease, releaseTurnLease, renewTurnLease } from "@csq/core/lib/turn-lock";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { chargeCredits, getCreditStatus } from "@csq/core/lib/credits";
import { getTemplateBody } from "@csq/core/lib/message-templates";
import { logAction } from "@csq/core/lib/audit";
import type { ChatMessage, ToolCallRecord } from "@csq/core/types/chat";

// OPS-2 (PRD 16): when no agent is active for the conversation (never
// deployed, paused, or unassigned), the customer gets ONE short fallback per
// day instead of silence (plan 07 6.6). Debounced on Conversation.settings,
// same pattern as the non-text courtesy reply. Inside Meta's 24h window this
// is free-form text; outside it the send is skipped + audited unless an
// approved template is configured (sendAgentMessage enforces that).
const STAND_DOWN_FALLBACK_MS = 24 * 60 * 60 * 1000;

async function sendStandDownFallback(args: {
  channel: Channel;
  tenantId: string;
  conversationId: string;
  customerPhone: string;
  conversationSettings: unknown;
}): Promise<void> {
  try {
    const parsed = z.record(z.unknown()).safeParse(args.conversationSettings ?? {});
    const settings = parsed.success ? parsed.data : {};
    const lastRaw =
      typeof settings.lastStandDownFallbackAt === "string"
        ? Date.parse(settings.lastStandDownFallbackAt)
        : NaN;
    if (!Number.isNaN(lastRaw) && Date.now() - lastRaw < STAND_DOWN_FALLBACK_MS) {
      return;
    }
    const body = await getTemplateBody(
      args.tenantId,
      "agent_inactive",
      "Terima kasih atas pesan Anda. Agent kami sedang tidak aktif sebentar - tim kami akan membalas segera."
    );
    if (!body) return;
    await sendAgentMessage({
      channel: args.channel,
      conversationId: args.conversationId,
      customerPhone: args.customerPhone,
      body,
      agentId: null,
      action: "conversation.agent_inactive",
      templateName: process.env.WHATSAPP_AGENT_FALLBACK_TEMPLATE || undefined,
    });
    await prisma.conversation.update({
      where: { id: args.conversationId },
      data: {
        settings: {
          ...settings,
          lastStandDownFallbackAt: new Date().toISOString(),
        },
      },
    });
  } catch (err) {
    console.error(
      `[agent-loop] stand-down fallback failed for ${args.conversationId}:`,
      err
    );
  }
}

// Fire-and-forget agent auto-reply for an inbound WhatsApp message - the
// Phase 6 ↔ Phase 7 wiring. Called from the webhook AFTER the inbound is
// recorded, NOT awaited, so Meta's 5s webhook timeout is never at risk. The
// ACK is sent by the caller before this work finishes.
//
// Resolution order for which agent replies:
//   1. conversation.assignedAgentId  - an explicit per-conversation assignment
//   2. channel.agentId               - the channel's default agent
// If the conversation is assigned to a human (assigneeUserId), the AI stands
// down (FR-AS-003): a human is handling it, so we do not auto-reply.
//
// Tenant always comes from the resolved channel - never from message content.
// All failures are caught and logged: a broken agent reply must never surface
// as an error to Meta (which would retry and spam the customer).
//
// D1 - turn serialization. Turns are serialized per conversation with a LEASE
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
  // The Message row that triggered this turn. D4: it is EXCLUDED from the
  // replayed history (it is appended once as the user message) so the model
  // never sees the same customer message twice.
  triggerMessageId?: string;
}): Promise<AgentTurnResult> {
  const { tenantId, conversationId, customerPhone, body, triggerMessageId } = args;

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
    await sendStandDownFallback({
      channel,
      tenantId,
      conversationId,
      customerPhone,
      conversationSettings: conversation.settings,
    });
    return { reply: "", toolCalls: [], stoodDown: true };
  }

  const agent = await prisma.agent.findFirst({
    where: { id: resolvedAgentId, tenantId },
  });
  // Only an ACTIVE agent can reply.
  if (!agent || agent.status !== "ACTIVE") {
    await sendStandDownFallback({
      channel,
      tenantId,
      conversationId,
      customerPhone,
      conversationSettings: conversation.settings,
    });
    return { reply: "", toolCalls: [], stoodDown: true };
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    return { reply: "", toolCalls: [], stoodDown: true };
  }
  // Phase 2 (PRD 13): a suspended tenant's agent stands down - no LLM turns,
  // no replies. Inbound keeps ingesting (the socket layer does not check
  // tenant status); the agent simply does not answer.
  if (tenant.status === "SUSPENDED") {
    return { reply: "", toolCalls: [], stoodDown: true };
  }

  // AI credit gate (PRD 14). At or above the monthly limit the agent stands
  // down before any LLM call; inbound keeps ingesting and staff can reply.
  // A failed check fails open: a billing read must not silence the agent.
  let credits: Awaited<ReturnType<typeof getCreditStatus>> | null = null;
  try {
    credits = await getCreditStatus(tenantId);
  } catch (err) {
    console.error(`[agent-loop] credit check failed for tenant ${tenantId}:`, err);
    // COR-6 (PRD 16): the fail-open event is audited with the reason, so a
    // silent billing outage is visible in the activity log.
    await logAction({
      tenantId,
      agentId: agent.id,
      action: "agent.credit_check_failed",
      entityType: "Conversation",
      entityId: conversationId,
      approvalStatus: "NONE",
      customerPhone,
      afterValue: {
        reason: err instanceof Error ? err.message : "unknown",
        at: new Date().toISOString(),
      },
    }).catch(() => undefined);
  }
  if (credits?.exhausted) {
    const settingsParsed = z.record(z.unknown()).safeParse(conversation.settings ?? {});
    const settings = settingsParsed.success ? settingsParsed.data : {};
    const monthKey = new Date().toISOString().slice(0, 7);
    if (settings.creditsExhaustedFor !== monthKey) {
      await logAction({
        tenantId,
        agentId: agent.id,
        action: "agent.credits_exhausted",
        entityType: "Conversation",
        entityId: conversationId,
        approvalStatus: "NONE",
        customerPhone,
        afterValue: { month: monthKey, limit: credits.limit, used: credits.used },
      });
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { settings: { ...settings, creditsExhaustedFor: monthKey } },
      });
    }
    return { reply: "", toolCalls: [], stoodDown: true };
  }

  // BOUNDED HISTORY WINDOW (no external session state). The recent transcript
  // is replayed from our own Message rows - the NEWEST AGENT_HISTORY_LIMIT
  // messages within the 1h window, in chronological order (fetch desc, take,
  // then reverse). A chat that goes quiet for an hour starts a fresh window,
  // so stale/incorrect facts cannot leak across windows and the prompt stays
  // bounded. The trigger message is excluded here (D4) because it is appended
  // once as the user message below - without the exclusion the model saw the
  // customer's last message twice. Continuity beyond the window lives in the
  // CSQ layer the agent pulls via tools on every fresh window: customer.read
  // (name/email), order.list (history), pipeline stage.
  const SESSION_TTL_MS = 60 * 60 * 1000;
  const AGENT_HISTORY_LIMIT = 20;
  const windowStart = new Date(Date.now() - SESSION_TTL_MS);
  const recentRows = await prisma.message.findMany({
    where: {
      conversationId,
      createdAt: { gte: windowStart },
      isInternal: false,
      // D6: never replay "[image]"-style placeholders as customer speech -
      // only real text and business-side outbound belong in the transcript.
      OR: [{ direction: "OUTBOUND" }, { kind: "TEXT" }],
      ...(triggerMessageId ? { id: { not: triggerMessageId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: AGENT_HISTORY_LIMIT,
    select: { direction: true, body: true },
  });
  // Newest-first rows → chronological OpenAI chat messages. INBOUND → user;
  // anything the agent or a human sent outbound → assistant.
  const history: ChatMessage[] = recentRows
    .reverse()
    .map((m) => ({
      role: m.direction === "INBOUND" ? "user" : "assistant",
      content: m.body,
    }));
  const isStartOfNewWindow = history.length === 0;

  // Fresh-window opener: one bounded line of safe structured facts
  // from CSQ so the agent doesn't ask the customer things the system already
  // knows. NOT a replay - a short summary pulled from the source of truth.
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
    // Customer scoping: HIGH-importance memories injected below belong to
    // THIS customer only (owner decision 2026-11-11).
    customerPhone,
  });

  const result = await runConversation({
    tenantId,
    agentId: agent.id, // CSQ UUID - keys executeTool/capability lookup
    conversationId,
    channelId: channel.id, // G1: routing context for approval follow-ups
    systemPrompt,
    history, // bounded 1h-window transcript (see above)
    userMessage: windowContext + body,
    customerPhone,
  });

  // Charge the reply after the LLM cost is incurred. The ref is the inbound
  // message that started the turn, so a retry cannot double charge. A failed
  // billing write is audited but never blocks the customer's reply.
  const chargeRef = triggerMessageId ?? randomUUID();
  try {
    await chargeCredits({ tenantId, source: "REPLY", refId: chargeRef });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await logAction({
      tenantId,
      agentId: agent.id,
      action: "agent.credit_charge_failed",
      entityType: "Conversation",
      entityId: conversationId,
      approvalStatus: "NONE",
      customerPhone,
      afterValue: { ref: chargeRef, error: message },
    }).catch(() => undefined);
  }

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

// Owner request 2026-11-10: when the AI errors, retry the turn instead of
// apologizing to the customer, and move the conversation to staff after the
// retries are exhausted. Capped exponential backoff: 2s doubling, 30s cap -
// 10 retries span roughly 3.5 minutes, which covers transient LLM outages
// (429 rate limits, provider blips) without the customer waiting on silence
// indefinitely.
const MAX_AGENT_RETRIES = 10;
const RETRY_DELAY_BASE_MS = 2_000;
const RETRY_DELAY_CAP_MS = 30_000;

// Last resort after MAX_AGENT_RETRIES failed turns: assign the conversation
// to the tenant owner - the same mutation conversation.handoff performs, so
// the AI stands down on the next inbound - and leave an internal note with
// the failure reason so staff knows why it landed on their desk.
async function escalateToHuman(args: {
  tenantId: string;
  conversationId: string;
  reason: string;
}): Promise<void> {
  const owner = await prisma.user.findFirst({
    where: { tenantId: args.tenantId, role: "OWNER" },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) {
    console.error(
      `[agent-loop] cannot escalate conversation ${args.conversationId}: no owner user`
    );
    return;
  }
  await prisma.conversation.updateMany({
    where: { id: args.conversationId, tenantId: args.tenantId },
    data: {
      assigneeUserId: owner.id,
      assignedAgentId: null,
      lastMessageAt: new Date(),
    },
  });
  await prisma.message.create({
    data: {
      tenantId: args.tenantId,
      conversationId: args.conversationId,
      direction: "OUTBOUND",
      senderType: "HUMAN",
      senderUserId: owner.id,
      body: `Dialihkan otomatis ke staff: AI gagal membalas setelah ${
        MAX_AGENT_RETRIES + 1
      }x percobaan (${args.reason}). Mohon balas pelanggan secara manual.`,
      isInternal: true,
    },
  });
  await logAction({
    tenantId: args.tenantId,
    agentId: null,
    action: "conversation.agent_error_handoff",
    entityType: "Conversation",
    entityId: args.conversationId,
    approvalStatus: "NONE",
    afterValue: {
      reason: args.reason,
      escalatedToUserId: owner.id,
      at: new Date().toISOString(),
    },
  });
}

export async function processInboundWithAgent(args: {
  channel: Channel;
  conversationId: string;
}): Promise<void> {
  // RLS context (PRD 16 SEC-1): the whole turn - lease, drain, LLM, send -
  // runs as the channel's tenant. The webhook and the Baileys runtime both
  // call this; entering the context here means neither caller can forget it.
  await withTenantContext(args.channel.tenantId, () =>
    processInboundWithAgentInner(args)
  );
}

async function processInboundWithAgentInner(args: {
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
    // Owner request 2026-11-10: an AI error is never answered with a canned
    // apology to the customer. The drain is retried through transient LLM
    // failures with capped exponential backoff; the turn lease is renewed
    // between attempts so the stale window can never let a second turn
    // double-reply during the backoff.
    let attempt = 0;
    for (;;) {
      try {
        await drainUnansweredInbound(channel, conversationId, tenantId);
        break;
      } catch (err) {
        if (attempt >= MAX_AGENT_RETRIES) throw err;
        attempt += 1;
        const delayMs = Math.min(
          RETRY_DELAY_BASE_MS * 2 ** (attempt - 1),
          RETRY_DELAY_CAP_MS
        );
        console.error(
          `[agent-loop] turn ${attempt}/${MAX_AGENT_RETRIES} failed for ${conversationId}, retrying in ${delayMs}ms: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        const stillOurs = await renewTurnLease(conversationId, tenantId, leaseId);
        if (!stillOurs) {
          // The lease was stolen while we backed off. Another turn now owns
          // the conversation - retrying on top of it would double-reply.
          throw err;
        }
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(
      `[agent-loop] Failed to process inbound for conversation ${conversationId}: ${message}`
    );
    // All retries exhausted: move the conversation to staff with a note
    // explaining why. Guarded - an escalation failure must not throw here.
    try {
      await escalateToHuman({ tenantId, conversationId, reason: message });
    } catch (escalationErr) {
      console.error(
        `[agent-loop] escalation to staff failed for ${conversationId}:`,
        escalationErr
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
    // Newest unanswered TEXT inbound (D6: media/other never drive a turn -
    // media is answered by the debounced courtesy reply at ingest time). Only
    // AGENT or HUMAN outbound counts as an answer - a SCENARIO message
    // (opening greeting, promo) must never mark a customer's question as
    // answered.
    const trigger = await prisma.message.findFirst({
      where: {
        conversationId,
        tenantId,
        direction: "INBOUND",
        kind: "TEXT",
      },
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
      triggerMessageId: trigger.id,
    });
    if (turn.stoodDown) return;

    // G6: a truncated turn (iteration cap / budget hit) may carry empty or
    // mid-thought content. Send a clean "still processing" message instead of
    // a partial reply, so the customer is never left hanging or handed a
    // half-finished answer. A non-truncated empty reply means the model had
    // nothing to say - nothing to send, and the drain stops on `attempted`.
    let replyBody = turn.reply;
    if (turn.truncated) {
      replyBody =
        "Mohon tunggu, saya sedang memproses permintaan Anda dan akan segera membalas.";
    }
    if (!replyBody.trim()) continue;

    // Reload the channel - if the owner disconnected (Putuskan) while the turn
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
