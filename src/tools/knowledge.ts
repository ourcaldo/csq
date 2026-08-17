import { z } from "zod";
import type { Knowledge } from "@prisma/client";
import type { ToolDefinition, ToolResult } from "@/types/tools";
import { findSimilar } from "@/lib/vector";

// knowledge.search — allowed by default (read-only). Uses pgvector semantic
// similarity when the caller supplies a queryEmbedding (Phase 6 will generate
// one from the agent runtime); otherwise falls back to Prisma text contains
// on title + content [SRS FR-KN-006]. All vector reads go through lib/vector.

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
  // Optional embedding from the agent runtime; enables semantic search.
  queryEmbedding: z.array(z.number()).optional(),
});
type KnowledgeSearchParams = z.infer<typeof knowledgeSearchSchema>;

const knowledgeSearch: ToolDefinition<KnowledgeSearchParams> = {
  name: "knowledge.search",
  description:
    "Search FAQ/policies/business info by keyword or semantic similarity.",
  category: "knowledge",
  parameters: knowledgeSearchSchema,
  defaultPermission: { allowed: true, requiresApproval: false },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    const limit = p.limit ?? 5;

    let docs: Knowledge[];
    if (p.queryEmbedding && p.queryEmbedding.length > 0) {
      const similar = await findSimilar("KnowledgeEmbedding", ctx.tenantId, p.queryEmbedding, { limit });
      if (similar.length === 0) {
        docs = [];
      } else {
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
    } else {
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
