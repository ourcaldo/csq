import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@csq/core/lib/auth";
import { getTenantEntitlements, getTenantUsage, monthStartUtc } from "@csq/core/lib/entitlements";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

// The tenant's plan entitlements + this month's usage. Drives the dashboard
// nav (feature visibility) and the usage counters. Read-only.

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  if (req.method !== "GET") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  const [entitlements, usage] = await Promise.all([
    getTenantEntitlements(tenantId),
    getTenantUsage(tenantId, monthStartUtc()),
  ]);

  return res.status(200).json(apiOk({ ...entitlements, usage }));
}
