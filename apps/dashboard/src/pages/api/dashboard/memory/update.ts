import type { NextApiRequest, NextApiResponse } from "next";
import type { Memory } from "@prisma/client";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { memoryImportanceUpdateSchema } from "@csq/core/types/memory";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Memory>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method !== "PUT") {
      return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
    }

    if (!requireRole(session, "OWNER")) {
      return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengubah memory.");
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
  });
}
