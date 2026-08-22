import { Prisma } from "@prisma/client";
import type { ScenarioRunStatus } from "@prisma/client";
import prisma from "@/lib/db";
import { getProvider } from "@/lib/whatsapp-provider";
import { logAction, toJsonValue } from "@/lib/audit";
import { CLOUD_API_WINDOW_MS } from "@/lib/inbox";
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
    let run: { id: string } | null = null;
    try {
      run = await prisma.scenarioRun.create({
        data: {
          tenantId,
          scenarioId: scenario.id,
          conversationId,
          status: "RUNNING",
          currentNodeId: null,
          context: toJsonValue(input.context),
          dedupKey: input.dedupKey,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        continue; // duplicate trigger — already ran/running for this ref
      }
      console.error(`[scenario] failed to create run for scenario ${scenario.id}:`, err);
      continue;
    }

    if (run) {
      void scheduleAdvance(run.id).catch((err: unknown) =>
        console.error(`[scenario] scheduleAdvance ${run.id} threw:`, err)
      );
    }
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

// ─────────────────────────── Helpers ───────────────────────────

function parseTriggerConfig(raw: unknown): { tagName?: string } | null {
  const parsed = triggerConfigSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
}
