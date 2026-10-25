import { z } from "zod";

// Embeddings for knowledge semantic retrieval (closes Gap G3). Any
// OpenAI-compatible provider (LLM_BASE_URL + LLM_API_KEY + a provider-specific
// LLM_EMBEDDING_MODEL); raw `fetch` + Zod at the boundary (matches the
// codebase HTTP style — no SDK dependency).
//
// Pick a multilingual embedding model (works for Bahasa Indonesia
// content/queries; English-only bge/nomic models were rejected for this
// reason). Qwen3-style vectors are NOT unit-length, but pgvector's `<=>`
// cosine distance used in lib/vector.ts is magnitude-invariant, so no
// normalization is required.
//
// Server-only. Secrets stay server-side. No `as` casts: the response is
// Zod-parsed at the boundary.

const LLM_API_KEY = process.env.LLM_API_KEY ?? "";
const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "";
// No provider-specific default: the model name depends on whichever provider
// LLM_BASE_URL points at, so it must be set explicitly. Unset → embeddings
// are "not configured" and knowledge.search degrades to keyword search.
const LLM_EMBEDDING_MODEL = process.env.LLM_EMBEDDING_MODEL ?? "";
const LLM_EMBEDDING_DIM = Number(
  process.env.LLM_EMBEDDING_DIM ?? "1024"
);

// OpenAI-compatible embeddings response shape. `.passthrough()` tolerates
// extra provider fields (model, usage, …) we don't need.
const embeddingResponseSchema = z
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
  return Boolean(LLM_API_KEY && LLM_BASE_URL && LLM_EMBEDDING_MODEL);
}

// Embed a single text into a LLM_EMBEDDING_DIM-dim vector. Throws on a
// missing key or non-2xx response; callers wrap in try/catch and degrade
// gracefully (knowledge write skips the embedding; knowledge.search falls back
// to keyword `contains`).
export async function embed(text: string): Promise<number[]> {
  if (!isEmbeddingsConfigured()) {
    throw new Error("LLM_API_KEY / LLM_BASE_URL / LLM_EMBEDDING_MODEL not set");
  }
  const res = await fetch(`${LLM_BASE_URL.replace(/\/$/, "")}/v1/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_EMBEDDING_MODEL,
      input: text,
      dimensions: LLM_EMBEDDING_DIM,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Embeddings failed: ${res.status} ${res.statusText}`
    );
  }
  const parsed = embeddingResponseSchema.parse(await res.json());
  if (parsed.data.length === 0) {
    throw new Error("Embeddings returned no data");
  }
  return parsed.data[0].embedding;
}

// Embed a batch of texts, returned in input order. Sorts the provider response
// by `index` defensively and validates the count matches. Provided for a future
// bulk backfill script; the core write path uses single-item `embed`.
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!isEmbeddingsConfigured()) {
    throw new Error("LLM_API_KEY / LLM_BASE_URL / LLM_EMBEDDING_MODEL not set");
  }
  if (texts.length === 0) return [];
  const res = await fetch(`${LLM_BASE_URL.replace(/\/$/, "")}/v1/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_EMBEDDING_MODEL,
      input: texts,
      dimensions: LLM_EMBEDDING_DIM,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Embeddings failed: ${res.status} ${res.statusText}`
    );
  }
  const parsed = embeddingResponseSchema.parse(await res.json());
  const ordered = [...parsed.data].sort((a, b) => {
    const ai = a.index ?? 0;
    const bi = b.index ?? 0;
    return ai - bi;
  });
  if (ordered.length !== texts.length) {
    throw new Error(
      `Embeddings count mismatch: sent ${texts.length}, got ${ordered.length}`
    );
  }
  return ordered.map((d) => d.embedding);
}
