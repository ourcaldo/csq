import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@csq/core/lib/auth";
import { getTenantEntitlements, getTenantUsage, monthStartUtc } from "@csq/core/lib/entitlements";
import prisma from "@csq/core/lib/db";
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

  // Billing facts are owner-only; STAFF never see an overdue banner.
  const overdue =
    session.user.role === "OWNER"
      ? await prisma.invoice.count({
          where: { tenantId, status: "ISSUED", dueAt: { lt: new Date() } },
        })
      : 0;

  return res
    .status(200)
    .json(apiOk({ ...entitlements, usage, billingOverdue: overdue > 0 }));
}
