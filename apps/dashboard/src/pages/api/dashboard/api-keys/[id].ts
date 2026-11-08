import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError, strQuery } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { logAction } from "@csq/core/lib/audit";

// DELETE /api/dashboard/api-keys/[id] - revoke a tenant API key (soft:
// revokedAt set, audit history intact). OWNER-only, tenant-scoped.
// Idempotent: revoking an already-revoked key succeeds.

export type RevokeResult = { id: string; revokedAt: Date | null };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<RevokeResult>>
) {
  if (req.method !== "DELETE") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner.");
  }
  const tenantId = requireTenant(session);

  const id = strQuery(req.query, "id");
  if (!id) return respondError(res, "VALIDATION_ERROR", "ID tidak valid.");

  const key = await prisma.apiKey.findFirst({ where: { id, tenantId } });
  if (!key) return respondError(res, "NOT_FOUND", "Kunci API tidak ditemukan.");
  if (key.revokedAt) {
    return res.status(200).json(apiOk({ id: key.id, revokedAt: key.revokedAt }));
  }

  const updated = await prisma.apiKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  await logAction({
    tenantId,
    agentId: null,
    action: "apikey.revoke",
    entityType: "ApiKey",
    entityId: updated.id,
    approvalStatus: "NONE",
    customerPhone: undefined,
    afterValue: { name: updated.name, prefix: updated.prefix },
  });
  return res.status(200).json(apiOk({ id: updated.id, revokedAt: updated.revokedAt }));
}
