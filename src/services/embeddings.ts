import { z } from "zod";

// Cloudflare Workers AI embeddings for knowledge semantic retrieval (G3).
// OpenAI-compatible endpoint, raw `fetch` + Zod at the boundary (matches the
// codebase HTTP style — no SDK dependency).
//
// Model: @cf/baai/bge-m3 — multilingual retrieval-tuned (works for Bahasa
// Indonesia content/queries), fixed 1024 dims = the pgvector column size
// (migration 20260820120000), so no schema change. Measured separation on
// Indonesian short queries: relevant 0.65-0.72 vs irrelevant <=0.55 —
// KNOWLEDGE_SIMILARITY_THRESHOLD=0.60 sits mid-gap. English-only models
// (bge-en, nomic) remain rejected for the same reason as before.
// bge-m3 vectors are NOT unit-length, but pgvector's `<=>` cosine distance
// used in lib/vector.ts is magnitude-invariant, so no normalization is
// required.
//
// Server-only. Secrets stay server-side. No `as` casts: the Cloudflare
// response is Zod-parsed at the boundary.

const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? "";
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const CLOUDFLARE_EMBEDDING_MODEL =
  process.env.CLOUDFLARE_EMBEDDING_MODEL ?? "@cf/baai/bge-m3";
const CLOUDFLARE_BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1`;

// OpenAI-compatible embeddings response shape. `.passthrough()` tolerates
// extra provider fields (model, usage, …) we don't need.
const embeddingsResponseSchema = z
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
  return Boolean(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ACCOUNT_ID);
}

// Embed a single text into a 1024-dim vector. Throws on a missing key or
// non-2xx response; callers wrap in try/catch and degrade gracefully
// (knowledge write skips the embedding; knowledge.search falls back to
// keyword `contains`).
export async function embed(text: string): Promise<number[]> {
  if (!isEmbeddingsConfigured()) {
    throw new Error("CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set");
  }
  const res = await fetch(`${CLOUDFLARE_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
    },
    body: JSON.stringify({
      model: CLOUDFLARE_EMBEDDING_MODEL,
      input: text,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Cloudflare embeddings failed: ${res.status} ${res.statusText}`
    );
  }
  const parsed = embeddingsResponseSchema.parse(await res.json());
  if (parsed.data.length === 0) {
    throw new Error("Cloudflare embeddings returned no data");
  }
  return parsed.data[0].embedding;
}

// Embed a batch of texts, returned in input order. Sorts the provider response
// by `index` defensively and validates the count matches. Provided for a future
// bulk backfill script; the core write path uses single-item `embed`.
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!isEmbeddingsConfigured()) {
    throw new Error("CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set");
  }
  if (texts.length === 0) return [];
  const res = await fetch(`${CLOUDFLARE_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
    },
    body: JSON.stringify({
      model: CLOUDFLARE_EMBEDDING_MODEL,
      input: texts,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Cloudflare embeddings failed: ${res.status} ${res.statusText}`
    );
  }
  const parsed = embeddingsResponseSchema.parse(await res.json());
  const ordered = [...parsed.data].sort((a, b) => {
    const ai = a.index ?? 0;
    const bi = b.index ?? 0;
    return ai - bi;
  });
  if (ordered.length !== texts.length) {
    throw new Error(
      `Cloudflare embeddings count mismatch: sent ${texts.length}, got ${ordered.length}`
    );
  }
  return ordered.map((d) => d.embedding);
}
