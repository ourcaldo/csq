import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

// Tenant info for the dashboard (cell status indicator, PRD §5/§26). Read-only;
// any authenticated tenant user may view. Secrets (openclawToken/baseUrl) are
// NOT returned — only the cell id and status.

export type TenantInfo = {
  id: string;
  name: string;
  slug: string;
  cellStatus: string | null;
  openclawCellId: string | null;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<TenantInfo>>
) {
  if (req.method !== "GET") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      slug: true,
      cellStatus: true,
      openclawCellId: true,
    },
  });
  if (!tenant) return respondError(res, "NOT_FOUND", "Tenant tidak ditemukan.");

  return res.status(200).json(apiOk(tenant));
}
