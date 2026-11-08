import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { clearGoogleCreds } from "@csq/core/lib/google-connect";
import prisma from "@csq/core/lib/db";

// POST /api/dashboard/sources/google/disconnect - OWNER only. Clears the
// tenant's Google tokens and marks every GOOGLE_SHEETS DataSource INACTIVE
// (the rows are kept so re-connecting reuses them; imported products/inventory
// are never touched).
type DisconnectResult = { disconnected: boolean };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<DisconnectResult>>
) {
  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat memutuskan akun Google.");
  }
  const tenantId = requireTenant(session);

  await clearGoogleCreds(tenantId);
  await prisma.dataSource.updateMany({
    where: { tenantId, type: "GOOGLE_SHEETS" },
    data: { status: "INACTIVE" },
  });

  return res.status(200).json(apiOk({ disconnected: true }));
}
