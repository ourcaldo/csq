import { Prisma } from "@prisma/client";
import type { ScenarioRunStatus } from "@prisma/client";
import prisma from "@/lib/db";
import { getProvider } from "@/lib/whatsapp-provider";
import { logAction, toJsonValue } from "@/lib/audit";
import { CLOUD_API_WINDOW_MS, assignConversation } from "@/lib/inbox";
import { setConversationStage } from "@/lib/pipeline";
import { generateText, isTextLlmConfigured } from "@/services/llm";
import { sendEmailWithProvider } from "@/services/email";
import { getEmailProvider } from "@/lib/email-config";
import { events } from "@/lib/events";
import type {
  ConversationNewEvent,
  OrderPurchasedEvent,
  ConversationTaggedEvent,
} from "@/lib/events";
import {
  scenarioGraphSchema,
  runContextSchema,
  triggerConfigSchema,
  type ScenarioGraph,
  type ScenarioNode,
  type RunContext,
  type ScenarioTriggerType,
  type TriggerConfig,
} from "@/types/scenario";

// Scenario execution engine. Fire-and-forget: a scenario injects outbound
// messages at trigger times and never owns the conversation — the AI agent
// handles any customer reply as normal. Runs are persisted state machines so a
// process restart/deploy never loses a paused (Wait) run; node-cron resumes
// due runs. Channel-agnostic; on Cloud API no send lands past the 24h
// customer-service window (skipped + audited at runtime).
//
// Concurrency is bounded: at most MAX_CONCURRENT advances run at once; overflow
// is deferred (set WAITING with resumeAt=now) and picked up by the cron tick —
// never silently dropped.

const MAX_CONCURRENT_ADVANCES = 16;
const MAX_NODES_PER_ADVANCE = 200; // defense vs. a malformed cyclic graph

let activeAdvances = 0;

// ─────────────────────────── Registration ───────────────────────────
// Subscribe the engine to the event bus. Called once from startScheduler()
// (server-only, after the Baileys/Sheets jobs). Idempotent.
let registered = false;
export function registerScenarioEngine(): void {
  if (registered) return;
  if (typeof window !== "undefined") return;
  registered = true;

  events.on("conversation.new", (e: ConversationNewEvent) => {
    void startRunsForTrigger("ON_NEW_CONVERSATION", e.tenantId, {
      dedupKey: e.conversationId,
      conversationId: e.conversationId,
      context: {
        customer_name: e.customerName ?? "",
        customer_phone: e.customerPhone,
        conversation_id: e.conversationId,
      },
    }).catch((err: unknown) => console.error("[scenario] conversation.new trigger threw:", err));
  });

  events.on("order.purchased", (e: OrderPurchasedEvent) => {
    void startRunsForTrigger("ON_PURCHASE", e.tenantId, {
      dedupKey: e.orderId,
      conversationId: e.conversationId,
      customerPhone: e.customerPhone,
      context: {
        customer_name: e.customerName ?? "",
        order_id: e.orderId,
        order_total: e.orderTotal,
        order_items: e.orderItems
          .map((it) => `${it.quantity}x ${it.productName}`)
          .join(", "),
      },
    }).catch((err: unknown) => console.error("[scenario] order.purchased trigger threw:", err));
  });

  events.on("conversation.tagged", (e: ConversationTaggedEvent) => {
    void startRunsForTrigger("ON_TAG_ADDED", e.tenantId, {
      dedupKey: `${e.conversationId}:${e.tagId}`,
      conversationId: e.conversationId,
      context: {
        customer_phone: "",
        conversation_id: e.conversationId,
        tag_name: e.tagName,
      },
    }).catch((err: unknown) => console.error("[scenario] conversation.tagged trigger threw:", err));
  });
}

// ─────────────────────────── Trigger → runs ───────────────────────────

type TriggerInput = {
  dedupKey: string;
  conversationId?: string;
  customerPhone?: string;
  context: RunContext;
};

async function startRunsForTrigger(
  triggerType: ScenarioTriggerType,
  tenantId: string,
  input: TriggerInput
): Promise<void> {
  const scenarios = await prisma.scenario.findMany({
    where: { tenantId, triggerType, status: "ACTIVE" },
  });
  if (scenarios.length === 0) return;

  for (const scenario of scenarios) {
    // ON_TAG_ADDED: filter by triggerConfig.tagName if set.
    if (triggerType === "ON_TAG_ADDED") {
      const cfgParsed = parseTriggerConfig(scenario.triggerConfig);
      if (cfgParsed?.tagName && cfgParsed.tagName !== input.context["tag_name"]) {
        continue;
      }
    }

    // Resolve a conversation to bind the run to. ON_PURCHASE may arrive without
    // a conversationId (order created outside a thread) — fall back to the most
    // recent conversation for this customer on a connected channel. If none,
    // the scenario can't deliver anything; skip + audit.
    let conversationId = input.conversationId;
    if (!conversationId && input.customerPhone) {
      conversationId = await resolveConversationByPhone(tenantId, input.customerPhone);
    }
    if (!conversationId) {
      await logAction({
        tenantId,
        agentId: null,
        action: "scenario.trigger_no_conversation",
        entityType: "Scenario",
        entityId: scenario.id,
        approvalStatus: "NONE",
        afterValue: { triggerType, dedupKey: input.dedupKey },
      });
      continue;
    }

    // Idempotent create: @@unique([scenarioId, dedupKey]) means a redelivered
    // event or double-fire collides and we skip the duplicate run.
    const runId = await createRunOnce(scenario, conversationId, input.dedupKey, input.context);
    if (runId) {
      void scheduleAdvance(runId).catch((err: unknown) =>
        console.error(`[scenario] scheduleAdvance ${runId} threw:`, err)
      );
    }
  }
}

// Create one run, idempotently: @@unique([scenarioId, dedupKey]) means a
// redelivered event or double-fire collides (P2002) and returns null instead of
// duplicating the run. Shared by the event triggers and the scheduler-driven
// triggers (ON_SCHEDULE / ON_NO_REPLY).
async function createRunOnce(
  scenario: { id: string; tenantId: string },
  conversationId: string,
  dedupKey: string,
  context: RunContext
): Promise<string | null> {
  try {
    const run = await prisma.scenarioRun.create({
      data: {
        tenantId: scenario.tenantId,
        scenarioId: scenario.id,
        conversationId,
        status: "RUNNING",
        currentNodeId: null,
        context: toJsonValue(context),
        dedupKey,
      },
    });
    return run.id;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return null; // duplicate trigger — already ran/running for this ref
    }
    console.error(`[scenario] failed to create run for scenario ${scenario.id}:`, err);
    return null;
  }
}

// Find the most recent conversation for a customer on a CONNECTED channel.
// Tenant-scoped; never crosses tenants.
async function resolveConversationByPhone(
  tenantId: string,
  customerPhone: string
): Promise<string | undefined> {
  const conv = await prisma.conversation.findFirst({
    where: { tenantId, customerPhone, channel: { status: "CONNECTED" } },
    orderBy: { lastMessageAt: "desc" },
    include: { channel: true },
  });
  return conv?.id;
}

// ─────────────────────────── Advance ───────────────────────────

async function scheduleAdvance(runId: string): Promise<void> {
  if (activeAdvances >= MAX_CONCURRENT_ADVANCES) {
    // Defer: the cron tick (resumePausedRuns) will pick this up on its next
    // beat. resumeAt=now makes it immediately eligible.
    await prisma.scenarioRun
      .update({ where: { id: runId }, data: { status: "WAITING", resumeAt: new Date() } })
      .catch(() => undefined);
    return;
  }
  activeAdvances++;
  try {
    await advanceRun(runId);
  } finally {
    activeAdvances--;
  }
}

type Transition =
  | { kind: "continue"; nextNodeId: string; result?: Prisma.InputJsonValue }
  | { kind: "wait"; nextNodeId: string; durationMs: number; result?: Prisma.InputJsonValue }
  | { kind: "end"; result?: Prisma.InputJsonValue };

async function advanceRun(runId: string): Promise<void> {
  const run = await prisma.scenarioRun.findUnique({
    where: { id: runId },
    include: { scenario: true },
  });
  if (!run || !run.scenario) return;
  if (run.status === "COMPLETED" || run.status === "FAILED") return;

  const graphParsed = scenarioGraphSchema.safeParse(run.scenario.graph);
  if (!graphParsed.success) {
    await failRun(run.id, run.tenantId, "Graph tidak valid saat runtime.");
    return;
  }
  const graph = graphParsed.data;
  const byId = new Map<string, ScenarioNode>(graph.nodes.map((n) => [n.id, n]));
  const contextParsed = runContextSchema.safeParse(run.context);
  const context: RunContext = contextParsed.success ? contextParsed.data : {};

  // Fresh run: start at the trigger node.
  let currentNodeId = run.currentNodeId;
  if (!currentNodeId) {
    const trigger = graph.nodes.find((n) => n.type === "trigger");
    if (!trigger) {
      await failRun(run.id, run.tenantId, "Tidak ada node trigger.");
      return;
    }
    currentNodeId = trigger.id;
  }

  // Re-entering a resumed WAITING run: currentNodeId already points at the
  // node AFTER the wait. Clear resumeAt and run.
  await prisma.scenarioRun.update({
    where: { id: run.id },
    data: { status: "RUNNING", resumeAt: null },
  });

  let iterations = 0;
  while (currentNodeId && iterations < MAX_NODES_PER_ADVANCE) {
    iterations++;
    const node = byId.get(currentNodeId);
    if (!node) {
      await failRun(run.id, run.tenantId, `Node tidak ditemukan: ${currentNodeId}.`);
      return;
    }

    const step = await prisma.scenarioRunStep.create({
      data: {
        tenantId: run.tenantId,
        runId: run.id,
        nodeId: node.id,
        nodeType: node.type,
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    try {
      const transition = await executeNode(node, {
        runId: run.id,
        tenantId: run.tenantId,
        conversationId: run.conversationId,
        context,
        graph,
      });

      const stepStatus: ScenarioRunStatus =
        transition.kind === "wait" ? "WAITING" : "COMPLETED";
      await prisma.scenarioRunStep.update({
        where: { id: step.id },
        data: {
          status: stepStatus,
          result: transition.result ?? Prisma.DbNull,
          completedAt: new Date(),
        },
      });

      if (transition.kind === "end") {
        await prisma.scenarioRun.update({
          where: { id: run.id },
          data: { status: "COMPLETED", currentNodeId: null, context: toJsonValue(context) },
        });
        return;
      }

      if (transition.kind === "wait") {
        const resumeAt = new Date(Date.now() + transition.durationMs);
        await prisma.scenarioRun.update({
          where: { id: run.id },
          data: {
            status: "WAITING",
            currentNodeId: transition.nextNodeId,
            resumeAt,
            context: toJsonValue(context),
          },
        });
        return; // paused; cron resumes
      }

      // continue
      currentNodeId = transition.nextNodeId;
      // Persist progress so a crash between nodes resumes from the right place.
      await prisma.scenarioRun.update({
        where: { id: run.id },
        data: { currentNodeId, context: toJsonValue(context) },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Node execution failed";
      await prisma.scenarioRunStep.update({
        where: { id: step.id },
        data: { status: "FAILED", error: message, completedAt: new Date() },
      });
      await failRun(run.id, run.tenantId, message);
      console.error(`[scenario] node ${node.type} (${node.id}) threw for run ${run.id}:`, err);
      return;
    }
  }

  if (iterations >= MAX_NODES_PER_ADVANCE) {
    await failRun(run.id, run.tenantId, "Loop terlalu panjang — kemungkinan siklus.");
  }
}

async function failRun(runId: string, tenantId: string, message: string): Promise<void> {
  await prisma.scenarioRun
    .update({ where: { id: runId }, data: { status: "FAILED" } })
    .catch(() => undefined);
  await logAction({
    tenantId,
    agentId: null,
    action: "scenario.run_failed",
    entityType: "ScenarioRun",
    entityId: runId,
    approvalStatus: "NONE",
    afterValue: { error: message },
  }).catch(() => undefined);
}

// ─────────────────────────── Node executors ───────────────────────────

async function executeNode(
  node: ScenarioNode,
  ctx: {
    runId: string;
    tenantId: string;
    conversationId: string;
    context: RunContext;
    graph: ScenarioGraph;
  }
): Promise<Transition> {
  switch (node.type) {
    case "trigger":
      return { kind: "continue", nextNodeId: nextOf(ctx.graph, node.id) };

    case "send": {
      const body = interpolate(node.data.body, ctx.context);
      const result = await sendScenarioMessage({
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        body,
      });
      return {
        kind: "continue",
        nextNodeId: nextOf(ctx.graph, node.id),
        result: { sent: result.sent, skippedWindow: result.skippedWindow },
      };
    }

    case "wait": {
      const next = nextOf(ctx.graph, node.id);
      return { kind: "wait", nextNodeId: next, durationMs: node.data.durationMs };
    }

    case "condition": {
      const branch = evaluateCondition(node, ctx.context);
      const target = edgeByHandle(ctx.graph, node.id, branch ? "true" : "false");
      if (!target) throw new Error(`Condition ${node.id} tidak memiliki cabang ${branch}.`);
      return { kind: "continue", nextNodeId: target };
    }

    case "tag": {
      await applyScenarioTag(ctx.tenantId, ctx.conversationId, node.data.tagName);
      return { kind: "continue", nextNodeId: nextOf(ctx.graph, node.id), result: { tag: node.data.tagName } };
    }

    case "ai": {
      const prompt = interpolate(node.data.prompt, ctx.context);
      const generated = await generateScenarioBody(ctx.tenantId, ctx.conversationId, prompt);
      if (!generated) {
        return {
          kind: "continue",
          nextNodeId: nextOf(ctx.graph, node.id),
          result: { sent: false, skipped: "llm" },
        };
      }
      const result = await sendScenarioMessage({
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        body: generated.slice(0, 4096),
      });
      return {
        kind: "continue",
        nextNodeId: nextOf(ctx.graph, node.id),
        result: { sent: result.sent, skippedWindow: result.skippedWindow, body: generated },
      };
    }

    case "setStage": {
      try {
        const moved = await setConversationStage({
          tenantId: ctx.tenantId,
          conversationId: ctx.conversationId,
          stageName: node.data.stageName,
          reason: "scenario",
        });
        return {
          kind: "continue",
          nextNodeId: nextOf(ctx.graph, node.id),
          result: { stageName: node.data.stageName, dealId: moved.dealId },
        };
      } catch (err) {
        // Not a run failure: an invalid stage name or a terminal-stage deal is
        // a config/runtime state the owner should see and fix — audited, and
        // the rest of the flow (e.g. the send) still runs.
        const message = err instanceof Error ? err.message : "Gagal mengubah tahap deal.";
        await logAction({
          tenantId: ctx.tenantId,
          agentId: null,
          action: "scenario.stage_skipped",
          entityType: "Conversation",
          entityId: ctx.conversationId,
          approvalStatus: "NONE",
          afterValue: { stageName: node.data.stageName, error: message },
        });
        return {
          kind: "continue",
          nextNodeId: nextOf(ctx.graph, node.id),
          result: { stageName: node.data.stageName, moved: false, error: message },
        };
      }
    }

    case "assign": {
      // Resolve the member fresh at runtime — a userId captured at config time
      // may since have been removed. Tenant-scoped lookup; skip + audit if gone.
      const user = await prisma.user.findFirst({
        where: { id: node.data.userId, tenantId: ctx.tenantId },
        select: { id: true, name: true, email: true },
      });
      if (!user) {
        await logAction({
          tenantId: ctx.tenantId,
          agentId: null,
          action: "scenario.assign_skipped",
          entityType: "Conversation",
          entityId: ctx.conversationId,
          approvalStatus: "NONE",
          afterValue: { userId: node.data.userId, reason: "Anggota tim tidak ditemukan." },
        });
        return {
          kind: "continue",
          nextNodeId: nextOf(ctx.graph, node.id),
          result: { assignedTo: null, skipped: "user_not_found" },
        };
      }
      // assignConversation enforces the assignedAgent XOR assignee invariant,
      // stands the AI down, and writes its own conversation.assign audit row.
      await assignConversation(ctx.conversationId, ctx.tenantId, { userId: user.id });
      return {
        kind: "continue",
        nextNodeId: nextOf(ctx.graph, node.id),
        result: { assignedTo: user.id, assignedToName: user.name ?? user.email },
      };
    }

    case "email": {
      const to = await resolveContactEmail(ctx.tenantId, ctx.conversationId);
      const provider = await getEmailProvider(ctx.tenantId);
      if (!to || !provider) {
        await logAction({
          tenantId: ctx.tenantId,
          agentId: null,
          action: "scenario.email_skipped",
          entityType: "Conversation",
          entityId: ctx.conversationId,
          approvalStatus: "NONE",
          afterValue: {
            subject: node.data.subject,
            reason: !to
              ? "Kontak tidak memiliki email."
              : "Email belum diatur oleh pemilik usaha (Pengaturan → Email).",
          },
        });
        return {
          kind: "continue",
          nextNodeId: nextOf(ctx.graph, node.id),
          result: { sent: false, skipped: !to ? "no_contact_email" : "provider_not_configured" },
        };
      }
      const subject = interpolate(node.data.subject, ctx.context);
      const text = interpolate(node.data.body, ctx.context);
      const info = await sendEmailWithProvider(provider, { to, subject, text });
      await logAction({
        tenantId: ctx.tenantId,
        agentId: null,
        action: "scenario.email_sent",
        entityType: "Conversation",
        entityId: ctx.conversationId,
        approvalStatus: "NONE",
        afterValue: { to, subject, provider: provider.type, messageId: info.messageId },
      });
      return {
        kind: "continue",
        nextNodeId: nextOf(ctx.graph, node.id),
        result: { sent: true, to },
      };
    }

    case "end":
      return { kind: "end" };
  }
}

// Single outgoing edge target (trigger/send/wait/tag have one plain edge).
function nextOf(graph: ScenarioGraph, nodeId: string): string {
  const edge = graph.edges.find((e) => e.source === nodeId && !e.sourceHandle);
  if (!edge) throw new Error(`Node ${nodeId} tidak memiliki edge keluar.`);
  return edge.target;
}

function edgeByHandle(
  graph: ScenarioGraph,
  nodeId: string,
  handle: "true" | "false"
): string | null {
  const edge = graph.edges.find((e) => e.source === nodeId && e.sourceHandle === handle);
  return edge ? edge.target : null;
}

function evaluateCondition(
  node: Extract<ScenarioNode, { type: "condition" }>,
  context: RunContext
): boolean {
  const raw = context[node.data.field];
  const present = raw !== undefined && raw !== null && raw !== "";
  const v = node.data.value;
  switch (node.data.operator) {
    case "is_set":
      return present;
    case "is_not_set":
      return !present;
    case "equals":
      return present ? String(raw) === v : false;
    case "not_equals":
      return present ? String(raw) !== v : true;
    case "contains":
      return present ? String(raw).includes(v) : false;
    case "greater_than":
      return present ? Number(raw) > Number(v) : false;
    case "less_than":
      return present ? Number(raw) < Number(v) : false;
  }
}

// Apply a tag from a scenario Tag node. Auto-creates the Tag for the tenant if
// it doesn't exist. Does NOT emit conversation.tagged — that would let a
// scenario's Tag node re-trigger other ON_TAG_ADDED scenarios and loop.
async function applyScenarioTag(
  tenantId: string,
  conversationId: string,
  tagName: string
): Promise<void> {
  const tag = await prisma.tag.upsert({
    where: { tenantId_name: { tenantId, name: tagName } },
    update: {},
    create: { tenantId, name: tagName },
  });
  await prisma.conversationTag.upsert({
    where: { conversationId_tagId: { conversationId, tagId: tag.id } },
    update: {},
    create: { tenantId, conversationId, tagId: tag.id },
  });
}

// ─────────────────────────── AI node generation ───────────────────────────

// Fixed, bounded system prompt for the ai node — the scenario author's prompt
// is the user message; this frames the output as a plain WhatsApp message body
// so the model never wraps it in quotes/markdown/explanations.
const AI_NODE_SYSTEM_PROMPT =
  "Kamu menulis satu pesan WhatsApp customer service untuk pelanggan UMKM Indonesia. " +
  "Tulis HANYA isi pesan — tanpa judul, tanpa tanda kutip, tanpa penjelasan tambahan. " +
  "Maksimal sekitar 600 karakter, Bahasa Indonesia yang ramah dan sopan. " +
  "Gunakan hanya fakta yang ada pada prompt; jangan mengarang harga, stok, atau kebijakan.";

// Generate a message body for the ai node. Returns null when the LLM is not
// configured or generation fails — the node is skipped + audited and the run
// continues (an LLM hiccup must not kill the rest of the flow).
async function generateScenarioBody(
  tenantId: string,
  conversationId: string,
  prompt: string
): Promise<string | null> {
  if (!isTextLlmConfigured()) {
    await logAction({
      tenantId,
      agentId: null,
      action: "scenario.ai_skipped",
      entityType: "Conversation",
      entityId: conversationId,
      approvalStatus: "NONE",
      afterValue: { reason: "LLM teks belum dikonfigurasi (FIREWORKS_API_KEY).", prompt },
    });
    return null;
  }
  try {
    return await generateText({ system: AI_NODE_SYSTEM_PROMPT, prompt });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal generate teks.";
    await logAction({
      tenantId,
      agentId: null,
      action: "scenario.ai_skipped",
      entityType: "Conversation",
      entityId: conversationId,
      approvalStatus: "NONE",
      afterValue: { reason: message, prompt },
    });
    return null;
  }
}

// Resolve the customer's email for the email node: the conversation's linked
// Contact, falling back to the tenant's Contact with the same phone.
// Tenant-scoped; returns null when no email is on file.
async function resolveContactEmail(
  tenantId: string,
  conversationId: string
): Promise<string | null> {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { contactId: true, customerPhone: true },
  });
  if (!conv) return null;
  const contact = conv.contactId
    ? await prisma.contact.findFirst({
        where: { id: conv.contactId, tenantId },
        select: { email: true },
      })
    : await prisma.contact.findFirst({
        where: { tenantId, phone: conv.customerPhone },
        select: { email: true },
      });
  const email = contact?.email?.trim();
  return email ? email : null;
}



// ─────────────────────────── Scenario send ───────────────────────────

async function sendScenarioMessage(input: {
  tenantId: string;
  conversationId: string;
  body: string;
}): Promise<{ sent: boolean; skippedWindow: boolean }> {
  const conv = await prisma.conversation.findFirst({
    where: { id: input.conversationId, tenantId: input.tenantId },
    include: { channel: true },
  });
  if (!conv || conv.channel.status !== "CONNECTED") {
    await logAction({
      tenantId: input.tenantId,
      agentId: null,
      action: "scenario.send_skipped_no_channel",
      entityType: "Message",
      entityId: input.conversationId,
      approvalStatus: "NONE",
      customerPhone: conv?.customerPhone,
      afterValue: { reason: "Conversation or channel missing/disconnected" },
    });
    return { sent: false, skippedWindow: false };
  }

  // Cloud API 24h customer-service window. Out-of-window → skip + audit
  // (never silently drop, never send into a Meta rejection). Baileys bypasses.
  if (conv.channel.provider === "CLOUD_API") {
    const lastInbound = await prisma.message.findFirst({
      where: { conversationId: input.conversationId, direction: "INBOUND" },
      orderBy: { createdAt: "desc" },
    });
    const withinWindow =
      !!lastInbound &&
      Date.now() - lastInbound.createdAt.getTime() <= CLOUD_API_WINDOW_MS;
    if (!withinWindow) {
      await logAction({
        tenantId: input.tenantId,
        agentId: null,
        action: "scenario.send_skipped_window",
        entityType: "Message",
        entityId: input.conversationId,
        approvalStatus: "NONE",
        customerPhone: conv.customerPhone,
        afterValue: { reason: "24h window closed on Cloud API", body: input.body },
      });
      return { sent: false, skippedWindow: true };
    }
  }

  const provider = getProvider(conv.channel);
  const sendResult = await provider.sendText({ to: conv.customerPhone, body: input.body });

  const message = await prisma.message.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      direction: "OUTBOUND",
      senderType: "SCENARIO",
      body: input.body,
      waMessageId: sendResult.waMessageId,
    },
  });

  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: { lastMessageAt: new Date() },
  });

  await logAction({
    tenantId: input.tenantId,
    agentId: null,
    action: "scenario.send",
    entityType: "Message",
    entityId: message.id,
    approvalStatus: "NONE",
    customerPhone: conv.customerPhone,
    afterValue: { body: input.body, waMessageId: sendResult.waMessageId },
  });

  return { sent: true, skippedWindow: false };
}

// ─────────────────────────── Interpolation ───────────────────────────
// Replace {{variable}} tokens with run-context values. Missing variables are
// dropped (empty string) so a send never crashes on a missing field. Variable
// names are identifier-restricted so no arbitrary content can ride inside a
// token; values are String()'d — no HTML, no eval, no injection surface.
export function interpolate(body: string, context: RunContext): string {
  return body.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_match, name: string) => {
    const v = context[name];
    if (v === null || v === undefined) return "";
    return String(v);
  });
}

// ─────────────────────────── Resume tick (node-cron) ───────────────────────────
// Called every minute by the scheduler. Resumes WAITING runs whose resumeAt has
// passed (Wait nodes) and deferred-at-cap runs (resumeAt=now). Bounded: each
// resumed run goes through scheduleAdvance, which respects the concurrency cap.
export async function resumePausedRuns(): Promise<void> {
  const due = await prisma.scenarioRun.findMany({
    where: { status: "WAITING", resumeAt: { lte: new Date() } },
    take: 50, // bounded per tick; remaining picked up next tick
  });
  for (const run of due) {
    void scheduleAdvance(run.id).catch((err: unknown) =>
      console.error(`[scenario] resume ${run.id} threw:`, err)
    );
  }
}

// ─────────────────────────── Scheduler-driven triggers ───────────────────────────
// ON_SCHEDULE and ON_NO_REPLY are not event-bus driven — the every-minute
// scheduler tick calls runScheduledTriggers(), which decides per scenario
// whether the current minute is a firing minute and creates one run per
// target conversation (deduped per conversation per day, bounded per fire).

// Schedule times are interpreted in this timezone (the target market), not
// the server clock — a 10:00 promo fires at 10:00 WIB regardless of VPS TZ.
const SCHEDULE_TZ = process.env.SCENARIO_SCHEDULE_TZ ?? "Asia/Jakarta";

// Upper bound on conversations per scheduled fire / per no-reply scan. A
// blast past this cap is truncated (most-recent first) + audited — never a
// silent drop, never an unbounded fan-out.
const SCHEDULE_TARGET_CAP = 100;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function nowInScheduleTz(now: Date): {
  hour: number;
  minute: number;
  weekday: number;
  date: string;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SCHEDULE_TZ,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

// Called every minute by the scheduler, alongside resumePausedRuns.
export async function runScheduledTriggers(): Promise<void> {
  const now = nowInScheduleTz(new Date());
  const time = `${String(now.hour).padStart(2, "0")}:${String(now.minute).padStart(2, "0")}`;

  // ON_SCHEDULE: fires in the configured minute; the dedup key (below) makes
  // a re-fire within the same day a no-op, so an exact minute match suffices.
  const scheduled = await prisma.scenario.findMany({
    where: { triggerType: "ON_SCHEDULE", status: "ACTIVE" },
  });
  for (const scenario of scheduled) {
    const cfg = parseTriggerConfig(scenario.triggerConfig);
    if (!cfg?.scheduleTime) continue;
    if (cfg.scheduleTime !== time) continue;
    const days = cfg.scheduleDays ?? [];
    if (days.length > 0 && !days.includes(now.weekday)) continue;
    await fireForConversations(scenario, {
      dedupPrefix: `sched:${now.date}`,
      tagFilter: cfg.tagName ?? null,
    });
  }

  // ON_NO_REPLY: conversations where OUR last message has gone unanswered for
  // longer than the configured silence window. At most one run per
  // conversation per day (dedup key carries the date).
  const noReply = await prisma.scenario.findMany({
    where: { triggerType: "ON_NO_REPLY", status: "ACTIVE" },
  });
  for (const scenario of noReply) {
    const cfg = parseTriggerConfig(scenario.triggerConfig);
    if (!cfg?.noReplyAfterMinutes) continue;
    await fireForSilentConversations(scenario, cfg.noReplyAfterMinutes, now.date);
  }
}

// ON_SCHEDULE targets: the tenant's OPEN conversations on CONNECTED channels,
// optionally narrowed to a tag (e.g. only customers tagged "promo"). Most
// recent activity first; capped at SCHEDULE_TARGET_CAP per fire.
async function fireForConversations(
  scenario: { id: string; tenantId: string },
  opts: { dedupPrefix: string; tagFilter: string | null }
): Promise<void> {
  const convs = await prisma.conversation.findMany({
    where: {
      tenantId: scenario.tenantId,
      status: "OPEN",
      channel: { status: "CONNECTED" },
      ...(opts.tagFilter
        ? { tags: { some: { tag: { name: opts.tagFilter } } } }
        : {}),
    },
    include: { contact: true },
    orderBy: { lastMessageAt: "desc" },
    take: SCHEDULE_TARGET_CAP,
  });
  if (convs.length === 0) return;
  if (convs.length === SCHEDULE_TARGET_CAP) {
    await logAction({
      tenantId: scenario.tenantId,
      agentId: null,
      action: "scenario.schedule_capped",
      entityType: "Scenario",
      entityId: scenario.id,
      approvalStatus: "NONE",
      afterValue: { cap: SCHEDULE_TARGET_CAP, note: "Target percakapan dipangkas ke 100 terbaru." },
    }).catch(() => undefined);
  }
  for (const conv of convs) {
    const runId = await createRunOnce(
      scenario,
      conv.id,
      `${opts.dedupPrefix}:${conv.id}`,
      {
        customer_name: conv.contact?.name ?? "",
        customer_phone: conv.customerPhone,
        conversation_id: conv.id,
      }
    );
    if (runId) {
      void scheduleAdvance(runId).catch((err: unknown) =>
        console.error(`[scenario] scheduleAdvance ${runId} threw:`, err)
      );
    }
  }
}

// ON_NO_REPLY targets: OPEN conversations on CONNECTED channels whose last
// activity is older than the silence window AND whose latest message is
// OUTBOUND (we replied; the customer never did). Oldest first. Conversations
// already nudged today are filtered out BEFORE the per-conversation last-
// message lookup so the every-minute scan stays cheap after the first pass.
async function fireForSilentConversations(
  scenario: { id: string; tenantId: string },
  afterMinutes: number,
  dateKey: string
): Promise<void> {
  const cutoff = new Date(Date.now() - afterMinutes * 60 * 1000);
  const candidates = await prisma.conversation.findMany({
    where: {
      tenantId: scenario.tenantId,
      status: "OPEN",
      channel: { status: "CONNECTED" },
      lastMessageAt: { lte: cutoff },
    },
    include: { contact: true },
    orderBy: { lastMessageAt: "asc" },
    take: SCHEDULE_TARGET_CAP,
  });
  if (candidates.length === 0) return;

  const prefix = `noreply:${dateKey}:`;
  const todays = await prisma.scenarioRun.findMany({
    where: { scenarioId: scenario.id, dedupKey: { startsWith: prefix } },
    select: { dedupKey: true },
  });
  const nudged = new Set(todays.map((r) => r.dedupKey.slice(prefix.length)));

  for (const conv of candidates) {
    if (nudged.has(conv.id)) continue;
    const last = await prisma.message.findFirst({
      where: { tenantId: scenario.tenantId, conversationId: conv.id },
      orderBy: { createdAt: "desc" },
      select: { direction: true },
    });
    if (!last || last.direction !== "OUTBOUND") continue;
    const runId = await createRunOnce(scenario, conv.id, `${prefix}${conv.id}`, {
      customer_name: conv.contact?.name ?? "",
      customer_phone: conv.customerPhone,
      conversation_id: conv.id,
    });
    if (runId) {
      void scheduleAdvance(runId).catch((err: unknown) =>
        console.error(`[scenario] scheduleAdvance ${runId} threw:`, err)
      );
    }
  }
}

// ─────────────────────────── Helpers ───────────────────────────

function parseTriggerConfig(raw: unknown): TriggerConfig | null {
  const parsed = triggerConfigSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
}
