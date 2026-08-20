import { executeTool } from "@/tools/execute";
import { listTools } from "@/tools";
import prisma from "@/lib/db";
import { zodToJsonSchema, type JsonSchema } from "@/lib/zod-to-json";
import type { ExecuteOutcome } from "@/types/tools";
import {
  chatCompletionResponseSchema,
  type ChatCompletionResponse,
  type ChatMessage,
  type RunResult,
  type ToolCallRecord,
} from "@/types/openclaw";
import type { Tenant } from "@prisma/client";
import {
  getCellForTenant,
  provisionCell,
  provisionAgentInCell,
  type CellConnection,
} from "@/services/openclaw-cell";

// OpenClaw integration (PRD §23A, §26). Each tenant gets its own isolated
// OpenClaw cell (one Gateway container per store); the cell's baseUrl + token
// are stored on the Tenant row and resolved per request by getCellForTenant.
// We drive the cell over HTTP: send messages + function tools to its
// OpenAI-compatible POST /v1/chat/completions, it returns a final reply or
// tool_calls; we execute the tools IN-PROCESS via executeTool (the Tool
// Gateway — tenant-scoped, permission-checked, audited) and feed `role:"tool"`
// results back, looping until the model finishes. OpenClaw never touches our DB.
//
// Agent targeting: the OpenAI `model` field selects the OpenClaw agent by id
// (`openclaw/<openclawAgentId>`). The `agentId` passed to executeTool is the
// CSQ Agent.id UUID (keys the capability lookup) — the two ids are distinct
// and must not be conflated.
//
// Server-only. Secrets stay server-side.

const MAX_TOOL_ITERATIONS = 6;

type FunctionTool = {
  type: "function";
  function: { name: string; description: string; parameters: JsonSchema };
};

// Build the function-tools array from the registry. The JSON Schema guides the
// model; server-side Zod (in executeTool) is the real validator.
function buildTools(): FunctionTool[] {
  return listTools().map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: zodToJsonSchema(t.parameters),
    },
  }));
}

async function chatCompletion(
  messages: ChatMessage[],
  openclawAgentId: string,
  conversationId: string,
  cell: CellConnection
): Promise<ChatCompletionResponse> {
  const body: {
    model: string;
    user: string;
    messages: ChatMessage[];
    tools: FunctionTool[];
    tool_choice: string;
  } = {
    model: `openclaw/${openclawAgentId}`,
    user: conversationId, // OpenClaw session key
    messages,
    tools: buildTools(),
    tool_choice: "auto",
  };

  const res = await fetch(`${cell.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cell.token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`OpenClaw chat completions failed: ${res.status} ${res.statusText}`);
  }
  // External boundary → Zod parse, never `as`.
  return chatCompletionResponseSchema.parse(await res.json());
}

// Render an ExecuteOutcome as the content of a `role:"tool"` message.
function serializeOutcome(o: ExecuteOutcome): string {
  switch (o.kind) {
    case "ok":
      return JSON.stringify(o.result);
    case "permission_denied":
      return "Permission denied: this action is not enabled for the agent.";
    case "approval_required":
      return JSON.stringify({
        approvalRequired: true,
        approvalId: o.payload.approvalId,
        action: o.payload.action,
      });
    case "tool_not_found":
      return "Tool not found.";
    case "validation_error":
      return `Validation error: ${o.message}`;
    case "not_found":
      return `Not found: ${o.message}`;
    case "internal_error":
      return `Error: ${o.message}`;
  }
}

export type RunConversationArgs = {
  tenantId: string;
  agentId: string; // CSQ Agent.id UUID — keys executeTool/capability lookup
  openclawAgentId: string; // OpenClaw agent id — the `model: openclaw/<id>` target
  conversationId: string;
  systemPrompt?: string;
  history: ChatMessage[];
  userMessage: string;
  customerPhone?: string;
};

// Run one customer turn against the CS agent: prepend the system prompt (if
// any), append the user message, then loop chat-completions ↔ tool execution
// until the model stops (or the iteration cap is hit). Returns the final reply
// + a log of tool calls performed.
export async function runConversation(args: RunConversationArgs): Promise<RunResult> {
  const messages: ChatMessage[] = [];
  if (args.systemPrompt) {
    messages.push({ role: "system", content: args.systemPrompt });
  }
  messages.push(...args.history, { role: "user", content: args.userMessage });
  const toolCallLog: ToolCallRecord[] = [];

  // Resolve the tenant's own OpenClaw cell once per turn (PRD §26).
  const cell = await getCellForTenant(args.tenantId);

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const resp = await chatCompletion(
      messages,
      args.openclawAgentId,
      args.conversationId,
      cell
    );
    const choice = resp.choices[0];
    if (!choice) break;

    const msg = choice.message;
    messages.push({
      role: "assistant",
      content: msg.content,
      tool_calls: msg.tool_calls,
    });

    if (choice.finish_reason !== "tool_calls" || !msg.tool_calls?.length) {
      return { reply: msg.content ?? "", toolCalls: toolCallLog };
    }

    for (const tc of msg.tool_calls) {
      const params: Record<string, unknown> = JSON.parse(tc.function.arguments);
      const outcome = await executeTool({
        toolName: tc.function.name,
        tenantId: args.tenantId,
        agentId: args.agentId,
        params,
        customerPhone: args.customerPhone,
      });
      const outcomeStr = serializeOutcome(outcome);
      toolCallLog.push({ tool: tc.function.name, params, outcome: outcomeStr });
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: outcomeStr,
      });
    }
  }

  // Iteration cap reached — surface the last assistant text if any.
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.content);
  return {
    reply: lastAssistant?.content ?? "",
    toolCalls: toolCallLog,
    truncated: true,
  };
}

// Provision an agent against the tenant's OpenClaw cell (PRD §26, plan 6.2).
// This is a REAL provisioning step, not just a DB write: it ensures the tenant
// has a cell (provisioning one if missing) and creates the agent inside that
// cell (via openclaw-cell), giving the agent its own workspace/sessions. The
// returned openclawAgentId is what runConversation sends as
// `model: openclaw/<openclawAgentId>`. Instructions are supplied at runtime
// via the system prompt (buildSystemPrompt), so there is no separate
// configureInstructions call. Marks the Agent ACTIVE on success.
export async function provisionAgent(args: {
  agentId: string;
  tenantId: string;
}): Promise<{ id: string; status: string; openclawCellId: string; openclawAgentId: string }> {
  const tenant = await prisma.tenant.findUnique({ where: { id: args.tenantId } });
  if (!tenant) {
    throw new Error(`Tenant ${args.tenantId} not found`);
  }

  // Ensure the tenant has a provisioned cell; reload to pick up the cell id.
  let cellTenant: Tenant | null = tenant;
  if (!tenant.openclawBaseUrl || !tenant.openclawToken) {
    await provisionCell(tenant);
    cellTenant = await prisma.tenant.findUnique({ where: { id: args.tenantId } });
    if (!cellTenant) throw new Error(`Tenant ${args.tenantId} vanished during cell provisioning`);
  }
  // Narrow: cellTenant is non-null from here on (original tenant or reloaded).
  if (!cellTenant) throw new Error(`Tenant ${args.tenantId} not found`);

  const agent = await prisma.agent.findUnique({ where: { id: args.agentId } });
  if (!agent) {
    throw new Error(`Agent ${args.agentId} not found`);
  }

  // Create the agent in the cell (or target the shared default in dev).
  const { openclawAgentId } = await provisionAgentInCell(cellTenant, agent);

  const updated = await prisma.agent.update({
    where: { id: agent.id },
    data: {
      openclawCellId: cellTenant.openclawCellId,
      openclawAgentId,
      status: "ACTIVE",
    },
    select: { id: true, status: true, openclawCellId: true, openclawAgentId: true },
  });

  return {
    id: updated.id,
    status: updated.status,
    openclawCellId: updated.openclawCellId ?? cellTenant.openclawCellId ?? "",
    openclawAgentId: updated.openclawAgentId ?? openclawAgentId,
  };
}
