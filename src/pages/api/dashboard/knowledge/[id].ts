import type { NextApiRequest, NextApiResponse } from "next";
import type { Knowledge } from "@prisma/client";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { logHuman } from "@/lib/audit";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { knowledgeUpdateSchema } from "@/types/knowledge";
import { upsertEmbedding, deleteEmbedding } from "@/lib/vector";
import { embed, isEmbeddingsConfigured } from "@/services/embeddings";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Knowledge | { id: string }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  const { id } = req.query;
  if (typeof id !== "string") {
    return respondError(res, "VALIDATION_ERROR", "ID knowledge tidak valid.");
  }

  if (req.method === "GET") {
    const knowledge = await prisma.knowledge.findFirst({ where: { id, tenantId } });
    if (!knowledge) return respondError(res, "NOT_FOUND", "Knowledge tidak ditemukan.");
    return res.status(200).json(apiOk(knowledge));
  }

  if (req.method === "PUT") {
    const parsed = knowledgeUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    const existing = await prisma.knowledge.findFirst({ where: { id, tenantId } });
    if (!existing) return respondError(res, "NOT_FOUND", "Knowledge tidak ditemukan.");
    const knowledge = await prisma.knowledge.update({
      where: { id },
      data: parsed.data,
    });
    await logHuman({
      tenantId,
      action: "knowledge.update",
      entityType: "Knowledge",
      entityId: id,
      beforeValue: existing,
      afterValue: knowledge,
    });
    // Re-embed on update so the vector reflects new title/content. Best-effort
    // graceful degradation — the update is already persisted above.
    if (isEmbeddingsConfigured()) {
      try {
        const vec = await embed(`${knowledge.title}\n${knowledge.content}`);
        await upsertEmbedding("KnowledgeEmbedding", id, tenantId, vec);
      } catch (err) {
        console.warn(
          `[knowledge.update] embedding upsert skipped for ${id}:`,
          err
        );
      }
    }
    return res.status(200).json(apiOk(knowledge));
  }

  if (req.method === "DELETE") {
    const existing = await prisma.knowledge.findFirst({ where: { id, tenantId } });
    if (!existing) return respondError(res, "NOT_FOUND", "Knowledge tidak ditemukan.");
    await prisma.knowledge.delete({ where: { id } });
    // Explicit vector cleanup via lib/vector.ts (symmetric with the upsert on
    // create/update). The FK cascade would also remove the row, but relying on
    // hidden cascade behavior is worse than an explicit, best-effort delete.
    try {
      await deleteEmbedding("KnowledgeEmbedding", id, tenantId);
    } catch (err) {
      console.warn(`[knowledge.delete] embedding cleanup skipped for ${id}:`, err);
    }
    await logHuman({
      tenantId,
      action: "knowledge.delete",
      entityType: "Knowledge",
      entityId: id,
      beforeValue: existing,
    });
    return res.status(200).json(apiOk({ id }));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
