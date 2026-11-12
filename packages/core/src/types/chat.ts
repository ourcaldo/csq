import { z } from "zod";

// The agent runtime speaks an OpenAI-compatible chat completions API. Every
// HTTP response from the provider is an external boundary → parsed with Zod,
// never `as`-cast.

export const toolCallPartSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({ name: z.string(), arguments: z.string() }),
});
export type ToolCallPart = z.infer<typeof toolCallPartSchema>;

// OpenAI chat message shape. `tool_call_id` is present only on role:"tool".
// The schema validates PROVIDER RESPONSES (string content); the request-side
// type below is wider because user messages may carry image parts (vision,
// PRD 03 amendment 2026-11-12).
export const chatMessageSchema = z.object({
  role: z.string(),
  content: z.string().nullable(),
  tool_calls: z.array(toolCallPartSchema).optional(),
  tool_call_id: z.string().optional(),
});

// Multimodal content parts, OpenAI format (text + image_url).
export type ChatMessagePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = {
  role: string;
  content: string | ChatMessagePart[] | null;
  tool_calls?: ToolCallPart[];
  tool_call_id?: string;
};

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
