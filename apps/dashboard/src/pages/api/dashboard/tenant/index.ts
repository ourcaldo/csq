import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

// Tenant info for the dashboard. Read-only; any authenticated tenant user may
// view.

export type TenantInfo = {
  id: string;
  name: string;
  slug: string;
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

  return withTenantContext(tenantId, async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
      },
    });
    if (!tenant) return respondError(res, "NOT_FOUND", "Tenant tidak ditemukan.");

    return res.status(200).json(apiOk(tenant));
  });
}
