import type { NextApiRequest, NextApiResponse } from "next";
import type { Memory } from "@prisma/client";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { logHuman } from "@/lib/audit";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { memoryImportanceUpdateSchema } from "@/types/memory";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Memory>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  if (req.method !== "PUT") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const parsed = memoryImportanceUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return respondError(res, "VALIDATION_ERROR", parsed.error.message);
  }

  const { id } = req.query;
  if (typeof id !== "string") {
    return respondError(res, "VALIDATION_ERROR", "ID memory tidak valid.");
  }

  const existing = await prisma.memory.findFirst({ where: { id, tenantId } });
  if (!existing) return respondError(res, "NOT_FOUND", "Memory tidak ditemukan.");

  const memory = await prisma.memory.update({
    where: { id },
    data: { importance: parsed.data.importance },
  });
  await logHuman({
    tenantId,
    action: "memory.update_importance",
    entityType: "Memory",
    entityId: id,
    beforeValue: existing,
    afterValue: memory,
  });
  return res.status(200).json(apiOk(memory));
}
