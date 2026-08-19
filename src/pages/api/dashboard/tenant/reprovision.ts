import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { provisionCell } from "@/services/openclaw-cell";

// Re-provision the tenant's OpenClaw cell (PRD §5/§26). OWNER-only. Used when
// cellStatus is FAILED or null, or to re-sync the connection. In "shared" dev
// mode this is a fast DB write; in "fleet" production mode it runs
// `openclaw fleet create` (which will error if a container already exists —
// surface that error to the owner).

export type ReprovisionResult = { cellStatus: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ReprovisionResult>>
) {
  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(
      res,
      "PERMISSION_DENIED",
      "Hanya owner yang dapat memprovisi ulang sel OpenClaw."
    );
  }
  const tenantId = requireTenant(session);

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return respondError(res, "NOT_FOUND", "Tenant tidak ditemukan.");

  try {
    await provisionCell(tenant);
    const fresh = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { cellStatus: true },
    });
    return res.status(200).json(apiOk({ cellStatus: fresh?.cellStatus ?? "PROVISIONED" }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal memprovisi ulang.";
    return respondError(res, "INTERNAL_ERROR", message);
  }
}
