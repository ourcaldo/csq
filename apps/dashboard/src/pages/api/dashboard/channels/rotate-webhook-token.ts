import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { logHuman } from "@csq/core/lib/audit";
import { generateWebhookVerifyToken } from "@csq/core/lib/webhook-token";

// Rotate the tenant's Meta webhook verify token (PRD 15 amendment
// 2026-11-24, tenant-own-WABA). The token lives on the Tenant row, so one
// call rotates every number the tenant owns. The caller MUST re-paste the
// new token into their Meta App Dashboard (the old one stops verifying).
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ verifyToken: string }>>
) {
  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requirePermission(session, "saluran.ubah")) {
    return respondError(res, "PERMISSION_DENIED", "Tidak punya izin mengubah saluran.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const previous = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { webhookVerifyToken: true },
    });
    const verifyToken = generateWebhookVerifyToken();
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { webhookVerifyToken: verifyToken },
    });
    await logHuman({
      tenantId,
      action: "webhook.rotate-token",
      entityType: "Tenant",
      entityId: tenantId,
      beforeValue: { webhookVerifyToken: previous?.webhookVerifyToken ?? null },
      afterValue: { webhookVerifyToken: verifyToken },
      actorEmail: session.user.email ?? undefined,
    });
    return res.status(200).json(apiOk({ verifyToken }));
  });
}
