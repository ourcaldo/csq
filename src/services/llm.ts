import { z } from "zod";

// Cloudflare Workers AI one-shot text generation for the scenario `ai` node.
// A plain, tool-less chat completion — NOT the agent loop (openclaw.ts):
// scenario message generation must not call tools, touch business data, or
// loop. Same OpenAI-compatible endpoint + account/token as the embeddings
// service; raw `fetch` + Zod at the boundary (no SDK).
//
// Model defaults to CLOUDFLARE_TEXT_MODEL (same family as the OpenClaw agents
// use via the gateway provider); keep them aligned so one Cloudflare account
// serves everything.
//
// Server-only. Secrets stay server-side. No `as` casts.

const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? "";
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const CLOUDFLARE_TEXT_MODEL =
  process.env.CLOUDFLARE_TEXT_MODEL ?? "@cf/qwen/qwen3.8-27b";
const CLOUDFLARE_BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1`;

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
  return Boolean(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ACCOUNT_ID);
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
    throw new Error("CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set");
  }
  const res = await fetch(`${CLOUDFLARE_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
    },
    body: JSON.stringify({
      model: CLOUDFLARE_TEXT_MODEL,
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
      `Cloudflare text completion failed: ${res.status} ${res.statusText}`
    );
  }
  const parsed = textCompletionResponseSchema.parse(await res.json());
  const content = parsed.choices[0]?.message.content?.trim() ?? "";
  if (!content) {
    throw new Error("Cloudflare text completion returned no content");
  }
  return content;
}
