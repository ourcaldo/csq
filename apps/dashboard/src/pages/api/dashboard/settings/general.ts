import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { logHuman } from "@csq/core/lib/audit";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

// General organization settings (PRD 28 follow-up, /dashboard/pengaturan/umum).
// OWNER-only. The display name writes the Tenant row; legalName/timezone/
// currency persist inside Tenant.settings (no migration needed).

const generalSchema = z.object({
  name: z.string().min(1).max(120),
  legalName: z.string().max(160).nullable().optional(),
  timezone: z.enum(["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"]),
  currency: z.enum(["IDR", "USD", "SGD"]),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ ok: true }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengubah pengaturan umum.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method !== "PUT") {
      return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
    }
    const parsed = generalSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Input tidak valid.");
    }
    const data = parsed.data;

    const existing = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!existing) return respondError(res, "NOT_FOUND", "Tenant tidak ditemukan.");

    const settings = {
      ...((existing.settings as Record<string, unknown> | null) ?? {}),
      legalName: data.legalName ?? null,
      timezone: data.timezone,
      currency: data.currency,
    };
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { name: data.name, settings },
    });
    await logHuman({
        actorEmail: session.user.email ?? undefined,
      tenantId,
      action: "settings.general_updated",
      entityType: "Tenant",
      entityId: tenantId,
      beforeValue: { name: existing.name },
      afterValue: { name: data.name, timezone: data.timezone, currency: data.currency },
    });
    return res.status(200).json(apiOk({ ok: true }));
  });
}
