import type { NextApiRequest, NextApiResponse } from "next";
import type { Knowledge } from "@prisma/client";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { knowledgeUpdateSchema } from "@/types/knowledge";

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
    return res.status(200).json(apiOk(knowledge));
  }

  if (req.method === "DELETE") {
    const existing = await prisma.knowledge.findFirst({ where: { id, tenantId } });
    if (!existing) return respondError(res, "NOT_FOUND", "Knowledge tidak ditemukan.");
    // Cascades to KnowledgeEmbedding. Embedding vector cleanup is owned by
    // lib/vector.ts (deleteEmbedding) on the ingestion path; cascade handles
    // the row removal here.
    await prisma.knowledge.delete({ where: { id } });
    return res.status(200).json(apiOk({ id }));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
