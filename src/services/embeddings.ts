import { z } from "zod";

// Fireworks embeddings for knowledge semantic retrieval (closes Gap G3).
// OpenAI-compatible endpoint, raw `fetch` + Zod at the boundary (matches the
// codebase HTTP style — no SDK dependency). Reuses FIREWORKS_API_KEY already
// used by the OpenClaw cell provider; no new provider/account.
//
// Model: fireworks/qwen3-embedding-8b — serverless, multilingual (works for
// Bahasa Indonesia content/queries; the English-only bge/nomic models were
// rejected for this reason), resizable via the `dimensions` param (Matryoshka).
// Qwen3 vectors are NOT unit-length, but pgvector's `<=>` cosine distance used
// in lib/vector.ts is magnitude-invariant, so no normalization is required.
//
// Server-only. Secrets stay server-side. No `as` casts: the Fireworks response
// is Zod-parsed at the boundary.

const FIREWORKS_API_KEY = process.env.FIREWORKS_API_KEY ?? "";
const FIREWORKS_EMBEDDING_MODEL =
  process.env.FIREWORKS_EMBEDDING_MODEL ?? "fireworks/qwen3-embedding-8b";
const FIREWORKS_EMBEDDING_DIM = Number(
  process.env.FIREWORKS_EMBEDDING_DIM ?? "1024"
);
const FIREWORKS_BASE_URL =
  process.env.FIREWORKS_BASE_URL ?? "https://api.fireworks.ai/inference";

// OpenAI-compatible embeddings response shape. `.passthrough()` tolerates
// extra provider fields (model, usage, …) we don't need.
const fireworksEmbeddingResponseSchema = z
  .object({
    data: z.array(
      z.object({
        embedding: z.array(z.number()),
        index: z.number().optional(),
      })
    ),
  })
  .passthrough();

export function isEmbeddingsConfigured(): boolean {
  return Boolean(FIREWORKS_API_KEY);
}

// Embed a single text into a FIREWORKS_EMBEDDING_DIM-dim vector. Throws on a
// missing key or non-2xx response; callers wrap in try/catch and degrade
// gracefully (knowledge write skips the embedding; knowledge.search falls back
// to keyword `contains`).
export async function embed(text: string): Promise<number[]> {
  if (!FIREWORKS_API_KEY) {
    throw new Error("FIREWORKS_API_KEY not set");
  }
  const res = await fetch(`${FIREWORKS_BASE_URL}/v1/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FIREWORKS_API_KEY}`,
    },
    body: JSON.stringify({
      model: FIREWORKS_EMBEDDING_MODEL,
      input: text,
      dimensions: FIREWORKS_EMBEDDING_DIM,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Fireworks embeddings failed: ${res.status} ${res.statusText}`
    );
  }
  const parsed = fireworksEmbeddingResponseSchema.parse(await res.json());
  if (parsed.data.length === 0) {
    throw new Error("Fireworks embeddings returned no data");
  }
  return parsed.data[0].embedding;
}

// Embed a batch of texts, returned in input order. Sorts the provider response
// by `index` defensively and validates the count matches. Provided for a future
// bulk backfill script; the core write path uses single-item `embed`.
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!FIREWORKS_API_KEY) {
    throw new Error("FIREWORKS_API_KEY not set");
  }
  if (texts.length === 0) return [];
  const res = await fetch(`${FIREWORKS_BASE_URL}/v1/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FIREWORKS_API_KEY}`,
    },
    body: JSON.stringify({
      model: FIREWORKS_EMBEDDING_MODEL,
      input: texts,
      dimensions: FIREWORKS_EMBEDDING_DIM,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Fireworks embeddings failed: ${res.status} ${res.statusText}`
    );
  }
  const parsed = fireworksEmbeddingResponseSchema.parse(await res.json());
  const ordered = [...parsed.data].sort((a, b) => {
    const ai = a.index ?? 0;
    const bi = b.index ?? 0;
    return ai - bi;
  });
  if (ordered.length !== texts.length) {
    throw new Error(
      `Fireworks embeddings count mismatch: sent ${texts.length}, got ${ordered.length}`
    );
  }
  return ordered.map((d) => d.embedding);
}
