import type { Knowledge } from "@prisma/client";
import { upsertEmbedding } from "@csq/core/lib/vector";
import { embed, isEmbeddingsConfigured } from "@csq/core/services/embeddings";

// PRD 31: embedding input for a knowledge row is the pair text plus its
// category. One row = one vector (KnowledgeEmbedding is 1:1 per row), which
// is why a multi-pair FAQ entry stores one row per pair.
//
// Best-effort: the caller has already persisted the row. If embeddings are
// unconfigured or the provider fails, warn and let retrieval degrade to
// keyword search. A knowledge write MUST NEVER fail because of embeddings.
export async function embedKnowledgeRow(
  knowledge: Pick<Knowledge, "id" | "title" | "content" | "category">,
  tenantId: string
): Promise<void> {
  if (!isEmbeddingsConfigured()) return;
  try {
    const text = knowledge.category
      ? `${knowledge.title}\n${knowledge.content}\n${knowledge.category}`
      : `${knowledge.title}\n${knowledge.content}`;
    const vec = await embed(text, { tenantId, refId: knowledge.id });
    await upsertEmbedding("KnowledgeEmbedding", knowledge.id, tenantId, vec);
  } catch (err) {
    console.warn(
      `[knowledge.embed] embedding upsert skipped for ${knowledge.id}:`,
      err
    );
  }
}
