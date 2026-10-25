import { z } from "zod";

// One-shot text generation for the scenario `ai` node. A plain, tool-less
// chat completion against any OpenAI-compatible provider (LLM_BASE_URL +
// LLM_API_KEY — Fireworks, OpenAI, Groq, OpenRouter, local vLLM, …); raw
// `fetch` + Zod at the boundary (matches the codebase HTTP style, no SDK).
// NOT the agent loop (llm-runtime.ts): scenario message generation must not
// call tools, touch business data, or loop. LLM_SCENARIO_MODEL overrides the
// shared LLM_CHAT_MODEL for scenario copywriting if desired.
//
// Server-only. Secrets stay server-side. No `as` casts.

const LLM_API_KEY = process.env.LLM_API_KEY ?? "";
const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "";
const LLM_TEXT_MODEL = process.env.LLM_SCENARIO_MODEL ?? process.env.LLM_CHAT_MODEL ?? "";

// OpenAI-compatible chat completion response shape. `.passthrough()` tolerates
// extra provider fields (id, usage, …) we don't need.
const textCompletionResponseSchema = z
  .object({
    choices: z.array(
      z.object({
        message: z.object({
          role: z.string().optional(),
          content: z.string().nullable(),
        }),
      })
    ),
  })
  .passthrough();

export function isTextLlmConfigured(): boolean {
  return Boolean(LLM_API_KEY && LLM_BASE_URL && LLM_TEXT_MODEL);
}

// Generate one message body from a prompt. Bounded by design: maxTokens caps
// the output (WhatsApp text messages cap at 4096 chars), temperature is low so
// customer-facing copy stays conservative, and an empty completion throws so
// callers skip + audit rather than sending a blank message. Throws on a
// missing key or non-2xx response; callers degrade gracefully (scenario run
// skips the send with an audit row — never a silent drop).
export async function generateText(input: {
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  if (!isTextLlmConfigured()) {
    throw new Error("LLM_API_KEY / LLM_BASE_URL / LLM_SCENARIO_MODEL (or LLM_CHAT_MODEL) not set");
  }
  const res = await fetch(`${LLM_BASE_URL.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_TEXT_MODEL,
      max_tokens: input.maxTokens ?? 400,
      temperature: input.temperature ?? 0.4,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.prompt },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Text completion failed: ${res.status} ${res.statusText}`
    );
  }
  const parsed = textCompletionResponseSchema.parse(await res.json());
  const content = parsed.choices[0]?.message.content?.trim() ?? "";
  if (!content) {
    throw new Error("Text completion returned no content");
  }
  return content;
}
