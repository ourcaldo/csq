import { z } from "zod";

// Fireworks one-shot text generation for the scenario `ai` node. A plain,
// tool-less chat completion — NOT the agent loop (openclaw.ts): scenario
// message generation must not call tools, touch business data, or loop. Same
// OpenAI-compatible endpoint + account/key as the embeddings service; raw
// `fetch` + Zod at the boundary (matches the codebase HTTP style, no SDK).
//
// Model defaults to the same Qwen chat model the OpenClaw agents use
// (OPENCLAW_AGENT_MODEL) so one Fireworks account serves everything;
// FIREWORKS_TEXT_MODEL overrides it for scenario copywriting if desired.
//
// Server-only. Secrets stay server-side. No `as` casts.

const FIREWORKS_API_KEY = process.env.FIREWORKS_API_KEY ?? "";
const FIREWORKS_BASE_URL =
  process.env.FIREWORKS_BASE_URL ?? "https://api.fireworks.ai/inference";
const FIREWORKS_TEXT_MODEL =
  process.env.FIREWORKS_TEXT_MODEL ??
  process.env.OPENCLAW_AGENT_MODEL ??
  "fireworks/accounts/fireworks/models/qwen3p7-plus";

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
  return Boolean(FIREWORKS_API_KEY);
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
  if (!FIREWORKS_API_KEY) {
    throw new Error("FIREWORKS_API_KEY not set");
  }
  const res = await fetch(`${FIREWORKS_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FIREWORKS_API_KEY}`,
    },
    body: JSON.stringify({
      model: FIREWORKS_TEXT_MODEL,
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
      `Fireworks text completion failed: ${res.status} ${res.statusText}`
    );
  }
  const parsed = textCompletionResponseSchema.parse(await res.json());
  const content = parsed.choices[0]?.message.content?.trim() ?? "";
  if (!content) {
    throw new Error("Fireworks text completion returned no content");
  }
  return content;
}
