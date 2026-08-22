import type { NextApiRequest, NextApiResponse } from "next";
import type { Knowledge } from "@prisma/client";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { logHuman } from "@/lib/audit";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { knowledgeCreateSchema } from "@/types/knowledge";
import { upsertEmbedding } from "@/lib/vector";
import { embed, isEmbeddingsConfigured } from "@/services/embeddings";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Knowledge>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat membuat knowledge.");
  }

  const parsed = knowledgeCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return respondError(res, "VALIDATION_ERROR", parsed.error.message);
  }

  const knowledge = await prisma.knowledge.create({
    data: { ...parsed.data, tenantId },
  });
  await logHuman({
    tenantId,
    action: "knowledge.create",
    entityType: "Knowledge",
    entityId: knowledge.id,
    afterValue: knowledge,
  });
  // Best-effort embedding so knowledge.search can retrieve this semantically.
  // Graceful degradation: if the key is missing or Fireworks fails, the row is
  // already saved — skip the embedding with a warning and let retrieval fall
  // back to keyword search. A knowledge write MUST NEVER fail because of
  // embeddings. All vector writes go through lib/vector.ts.
  if (isEmbeddingsConfigured()) {
    try {
      const vec = await embed(`${knowledge.title}\n${knowledge.content}`);
      await upsertEmbedding("KnowledgeEmbedding", knowledge.id, tenantId, vec);
    } catch (err) {
      console.warn(
        `[knowledge.create] embedding upsert skipped for ${knowledge.id}:`,
        err
      );
    }
  }
  return res.status(201).json(apiOk(knowledge));
}
