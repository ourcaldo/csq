import type { NextApiRequest, NextApiResponse } from "next";
import type { Memory } from "@prisma/client";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Memory | { id: string }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const { id } = req.query;
    if (typeof id !== "string") {
      return respondError(res, "VALIDATION_ERROR", "ID memory tidak valid.");
    }

    if (req.method === "GET") {
      const memory = await prisma.memory.findFirst({ where: { id, tenantId } });
      if (!memory) return respondError(res, "NOT_FOUND", "Memory tidak ditemukan.");
      return res.status(200).json(apiOk(memory));
    }

    if (req.method === "DELETE") {
      if (!requireRole(session, "OWNER")) {
        return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat menghapus memory.");
      }
      const existing = await prisma.memory.findFirst({ where: { id, tenantId } });
      if (!existing) return respondError(res, "NOT_FOUND", "Memory tidak ditemukan.");
      await prisma.memory.delete({ where: { id } });
      await logHuman({
        tenantId,
        action: "memory.delete",
        entityType: "Memory",
        entityId: id,
        beforeValue: existing,
      });
      return res.status(200).json(apiOk({ id }));
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
