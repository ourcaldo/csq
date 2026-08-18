import type { NextApiRequest, NextApiResponse } from "next";
import type { Knowledge } from "@prisma/client";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { logHuman } from "@/lib/audit";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { knowledgeCreateSchema } from "@/types/knowledge";

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
  // NOTE: embedding upsert is handled separately (Phase 5 / ingestion path)
  // via lib/vector.ts — never raw SQL here.
  return res.status(201).json(apiOk(knowledge));
}
