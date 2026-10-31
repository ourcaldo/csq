import { executeTool } from "@/tools/execute";
import { listTools } from "@/tools";
import { zodToJsonSchema, type JsonSchema } from "@/lib/zod-to-json";
import type { ExecuteOutcome } from "@/types/tools";
import {
  chatCompletionResponseSchema,
  type ChatCompletionResponse,
  type ChatMessage,
  type RunResult,
  type ToolCallRecord,
} from "@/types/chat";

// Direct OpenAI-compatible agent loop. No sidecar, no per-tenant cells: the
// app itself drives POST /v1/chat/completions on any OpenAI-compatible
// provider configured by LLM_BASE_URL/LLM_API_KEY/LLM_CHAT_MODEL. The model returns either a
// final reply or tool_calls; we execute the tools IN-PROCESS via executeTool
// (the Tool Gateway — tenant-scoped, permission-checked, audited) and feed
// `role:"tool"` results back, looping until the model finishes.
//
// Server-only. Secrets stay server-side.

const LLM_API_KEY = process.env.LLM_API_KEY ?? "";
const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "";
const LLM_CHAT_MODEL = process.env.LLM_CHAT_MODEL ?? "";

export function isAgentLlmConfigured(): boolean {
  return Boolean(LLM_API_KEY && LLM_BASE_URL && LLM_CHAT_MODEL);
}

// G6: the order workflow is ~4-5 tool calls (search product → read stock →
// read price → create order → confirm). 10 gives headroom for verify/refine
// loops without running the loop unboundedly.
const MAX_TOOL_ITERATIONS = 10;

// D1: one chat call must never hang a turn. Hard timeout per call, one retry
// on transient failures (429 / 5xx / timeout), and a budget for the whole
// turn so the loop always terminates while the customer is still waiting.
// The turn budget (90s) must stay well under the turn-lease stale window
// (3 minutes, src/lib/turn-lock.ts) so a live turn is never stolen.
const LLM_TIMEOUT_MS = 30_000;
const TURN_BUDGET_MS = 90_000;

// Carries retryability out of the fetch without a type assertion.
class LlmHttpError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
  }
}

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

async function chatCompletionOnce(
  messages: ChatMessage[],
  user: string
): Promise<ChatCompletionResponse> {
  const res = await fetch(`${LLM_BASE_URL.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_CHAT_MODEL,
      user,
      messages,
      tools: buildTools(),
      tool_choice: "auto",
    }),
    // D1: no fetch may outlive the turn. AbortSignal.timeout rejects with a
    // DOMException named "TimeoutError".
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new LlmHttpError(
      `LLM chat completions failed: ${res.status} ${res.statusText}`,
      res.status === 429 || res.status >= 500
    );
  }
  // External boundary → Zod parse, never `as`.
  return chatCompletionResponseSchema.parse(await res.json());
}

async function chatCompletion(
  messages: ChatMessage[],
  user: string
): Promise<ChatCompletionResponse> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await chatCompletionOnce(messages, user);
    } catch (err) {
      lastError = err;
      const retryable =
        (err instanceof LlmHttpError && err.retryable) ||
        (err instanceof Error && err.name === "TimeoutError");
      // 4xx (bad model name, bad key) will not fix themselves - fail fast.
      if (!retryable) break;
    }
  }
  throw lastError;
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
  conversationId: string;
  channelId?: string; // G1: routing context for approval follow-ups
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
  const deadline = Date.now() + TURN_BUDGET_MS;

  const lastAssistantText = (): string => {
    const last = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.content !== null && m.content !== undefined);
    return last?.content ?? "";
  };

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    // D1: budget check BEFORE paying for another LLM round-trip, so a slow
    // provider can never extend a turn past the lease stale window.
    if (Date.now() > deadline) {
      return { reply: lastAssistantText(), toolCalls: toolCallLog, truncated: true };
    }

    const resp = await chatCompletion(messages, args.conversationId);
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
      // H5: guard the model's tool-call arguments parse. If the model emits
      // malformed JSON, do NOT throw (that would abort the whole turn and the
      // outer catch would only send a canned fallback). Instead surface a
      // `role:"tool"` error to the model and continue the loop so it can
      // self-correct within the existing iteration budget.
      let params: Record<string, unknown>;
      try {
        params = JSON.parse(tc.function.arguments);
      } catch {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content:
            "Invalid JSON arguments; please retry with valid JSON.",
        });
        continue;
      }
      const outcome = await executeTool({
        toolName: tc.function.name,
        tenantId: args.tenantId,
        agentId: args.agentId,
        params,
        customerPhone: args.customerPhone,
        conversationId: args.conversationId,
        channelId: args.channelId,
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
  return {
    reply: lastAssistantText(),
    toolCalls: toolCallLog,
    truncated: true,
  };
}
