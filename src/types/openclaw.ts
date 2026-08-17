import { z } from "zod";

// OpenClaw sidecar speaks an OpenAI-compatible chat completions API (memory:
// openclaw-integration). Every HTTP response from the sidecar is an external
// boundary → parsed with Zod, never `as`-cast.

export const toolCallPartSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({ name: z.string(), arguments: z.string() }),
});
export type ToolCallPart = z.infer<typeof toolCallPartSchema>;

// OpenAI chat message shape. `tool_call_id` is present only on role:"tool".
export const chatMessageSchema = z.object({
  role: z.string(),
  content: z.string().nullable(),
  tool_calls: z.array(toolCallPartSchema).optional(),
  tool_call_id: z.string().optional(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatCompletionResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: chatMessageSchema,
      finish_reason: z.string(),
    })
  ),
});
export type ChatCompletionResponse = z.infer<typeof chatCompletionResponseSchema>;

// One executed tool call within a conversation run, for logging/debug.
export type ToolCallRecord = {
  tool: string;
  params: Record<string, unknown>;
  outcome: string;
};

export type RunResult = {
  reply: string;
  toolCalls: ToolCallRecord[];
  truncated?: boolean;
};
