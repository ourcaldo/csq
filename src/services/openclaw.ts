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

// OpenClaw integration (PRD §23A, memory: openclaw-integration). The sidecar is
// a separate self-hosted Node "Gateway" process exposing an OpenAI-compatible
// POST /v1/chat/completions on loopback port 18789. We drive it over HTTP:
// send messages + function tools, it returns either a final reply or
// tool_calls; we execute the tools IN-PROCESS via executeTool (the Tool
// Gateway — tenant-scoped, permission-checked, audited) and feed `role:"tool"`
// results back, looping until the model finishes. OpenClaw never touches our DB.
//
// Server-only. Secrets (OPENCLAW_API_KEY) stay server-side; loopback-only.

const BASE_URL = process.env.OPENCLAW_BASE_URL ?? "http://127.0.0.1:18789";
const API_KEY = process.env.OPENCLAW_API_KEY ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? "";
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
  agentId: string,
  conversationId: string
): Promise<ChatCompletionResponse> {
  const body: {
    model: string;
    user: string;
    messages: ChatMessage[];
    tools: FunctionTool[];
    tool_choice: string;
  } = {
    model: `openclaw/${agentId}`,
    user: conversationId, // OpenClaw session key
    messages,
    tools: buildTools(),
    tool_choice: "auto",
  };

  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      "x-openclaw-agent-id": agentId,
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
  agentId: string;
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

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const resp = await chatCompletion(messages, args.agentId, args.conversationId);
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

// MVP provisioning: a single OpenClaw cell is pre-provisioned for the demo
// tenant (memory: per-tenant = one cell; does not scale, but MVP is one
// tenant). This records the sidecar agent id on the Agent row so runConversation
// can target it. Full fleet provisioning is out of scope for the MVP.
export async function provisionAgent(
  agentId: string,
  openclawAgentId: string
): Promise<void> {
  await prisma.agent.update({
    where: { id: agentId },
    data: { openclawAgentId, status: "ACTIVE" },
  });
}
