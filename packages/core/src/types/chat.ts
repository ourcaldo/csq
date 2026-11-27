import { z } from "zod";

// The agent runtime speaks an OpenAI-compatible chat completions API. Every
// HTTP response from the provider is an external boundary → parsed with Zod,
// never `as`-cast.

export const toolCallPartSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({ name: z.string(), arguments: z.string() }),
  // Gemini 3 (OpenAI-compat) attaches its thought signature here on the first
  // tool call. It MUST be echoed back unchanged on the next request or the
  // follow-up is rejected with 400 INVALID_ARGUMENT (thought-signature rule).
  extra_content: z.unknown().optional(),
});
export type ToolCallPart = z.infer<typeof toolCallPartSchema>;

// OpenAI chat message shape. `tool_call_id` is present only on role:"tool".
// The schema validates PROVIDER RESPONSES (string content); the request-side
// type below is wider because user messages may carry image parts (vision,
// PRD 03 amendment 2026-11-12).
export const chatMessageSchema = z.object({
  role: z.string(),
  // Gemini's compat layer OMITS content on a tool-call message (the key is
  // absent, not null) - nullish keeps that response parseable. The runtime
  // normalizes it to null before echoing the message back.
  content: z.string().nullish(),
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
  // PRD 33: provider usage is optional - compat layers may omit it. A missing
  // usage still parses and yields a row with null tokens and null cost.
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
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
