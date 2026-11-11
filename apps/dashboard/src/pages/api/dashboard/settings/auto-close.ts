import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import { logHuman } from "@csq/core/lib/audit";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import {
  autoCloseSchema,
  getAutoCloseConfig,
  saveAutoCloseConfig,
} from "@csq/core/lib/auto-close";

// Auto session close setting (PRD 03 amendment 2026-11-11): OWNER-only.
// Stored in Tenant.settings.autoClose; the worker's closeIdleSessions
// consumes it. GET/PUT - no secrets, but the behavior change is an
// owner-level decision, same boundary as source priority.

type AutoCloseResponse = {
  enabled: boolean;
  idleMinutes: number;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<AutoCloseResponse>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(
      res,
      "PERMISSION_DENIED",
      "Hanya owner yang dapat mengatur penutupan sesi otomatis."
    );
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method === "GET") {
      const config = await getAutoCloseConfig(tenantId);
      return res.status(200).json(apiOk(config));
    }

    if (req.method === "PUT") {
      const parsed = autoCloseSchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(
          res,
          "VALIDATION_ERROR",
          parsed.error.issues[0]?.message ?? "Konfigurasi tidak valid."
        );
      }
      const before = await getAutoCloseConfig(tenantId);
      await saveAutoCloseConfig(tenantId, parsed.data);
      await logHuman({
        tenantId,
        action: "session.autoclose_update",
        entityType: "Tenant",
        entityId: tenantId,
        beforeValue: before,
        afterValue: parsed.data,
      });
      return res.status(200).json(apiOk(parsed.data));
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
