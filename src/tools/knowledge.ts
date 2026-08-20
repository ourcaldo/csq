import { z } from "zod";
import type { Knowledge } from "@prisma/client";
import type { ToolDefinition, ToolResult } from "@/types/tools";
import { findSimilar } from "@/lib/vector";
import { embed, isEmbeddingsConfigured } from "@/services/embeddings";

// knowledge.search — allowed by default (read-only). Generates a query
// embedding server-side from `query` via Fireworks Qwen3, then runs pgvector
// cosine similarity through lib/vector.ts. Falls back to Prisma text `contains`
// on title + content when embeddings are not configured, the embedding call
// fails, or semantic search returns nothing [SRS FR-KN-006]. All vector reads
// go through lib/vector. The embedding is generated here (not by the agent
// runtime) because the model cannot produce a meaningful 1024-dim vector.

// Cosine similarity threshold for semantic results. Qwen3 similarities on
// Indonesian short-text cluster lower than the old OpenAI default; env-tunable.
const SIMILARITY_THRESHOLD = Number(
  process.env.KNOWLEDGE_SIMILARITY_THRESHOLD ?? "0.5"
);

type SerializedKnowledge = {
  id: string;
  type: string;
  title: string;
  content: string;
};

function serializeKnowledge(k: Knowledge): SerializedKnowledge {
  return { id: k.id, type: k.type, title: k.title, content: k.content };
}

const knowledgeSearchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional(),
});
type KnowledgeSearchParams = z.infer<typeof knowledgeSearchSchema>;

const knowledgeSearch: ToolDefinition<KnowledgeSearchParams> = {
  name: "knowledge.search",
  description:
    "Cari FAQ, kebijakan toko, dan informasi usaha. WAJIB dipakai sebelum menjawab pertanyaan tentang kebijakan/FAQ/info toko; jangan mengarang.",
  category: "knowledge",
  parameters: knowledgeSearchSchema,
  defaultPermission: { allowed: true, requiresApproval: false },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    const limit = p.limit ?? 5;

    let docs: Knowledge[] = [];

    // Semantic path: embed the query, run pgvector similarity, hydrate ranked
    // Knowledge rows. Any failure (no key, network, empty results) falls through
    // to the keyword path below.
    if (isEmbeddingsConfigured()) {
      try {
        const queryVec = await embed(p.query);
        const similar = await findSimilar("KnowledgeEmbedding", ctx.tenantId, queryVec, {
          limit,
          threshold: SIMILARITY_THRESHOLD,
        });
        if (similar.length > 0) {
          const ids = similar.map((s) => s.knowledgeId);
          const found = await ctx.prisma.knowledge.findMany({
            where: { tenantId: ctx.tenantId, id: { in: ids } },
          });
          const byId = new Map(found.map((d) => [d.id, d]));
          // Preserve similarity ranking from findSimilar.
          docs = similar
            .map((s) => byId.get(s.knowledgeId))
            .filter((d): d is Knowledge => d !== undefined);
        }
      } catch (err) {
        console.warn(
          "[knowledge.search] semantic retrieval failed, falling back to keyword:",
          err
        );
      }
    }

    // Keyword fallback: semantic path empty OR threw OR no key configured.
    if (docs.length === 0) {
      docs = await ctx.prisma.knowledge.findMany({
        where: {
          tenantId: ctx.tenantId,
          OR: [
            { title: { contains: p.query, mode: "insensitive" } },
            { content: { contains: p.query, mode: "insensitive" } },
          ],
        },
        take: limit,
        orderBy: { updatedAt: "desc" },
      });
    }

    await ctx.audit({
      action: "knowledge.search",
      entityType: "knowledge",
      entityId: p.query,
    });
    return { success: true, data: docs.map(serializeKnowledge) };
  },
};

export const knowledgeTools: ToolDefinition<any>[] = [knowledgeSearch];
