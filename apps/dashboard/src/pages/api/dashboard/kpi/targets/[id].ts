import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { kpiTargetUpdateSchema } from "@csq/core/types/kpi";
import type { KpiTarget } from "@prisma/client";

// Edit one KPI target (PRD 17): targetValue / thresholdMinutes / active only.
// scope/metric/period are fixed for the KPI's lifetime - a change of meaning
// is a new KPI (closed-period snapshots keep their own denormalized target).
// Deactivation (active=false) hides the KPI from the report but never
// deletes its history.

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<KpiTarget>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengatur KPI.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method !== "PATCH") {
      return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
    }

    const { id } = req.query;
    if (typeof id !== "string") {
      return respondError(res, "VALIDATION_ERROR", "ID KPI tidak valid.");
    }

    const existing = await prisma.kpiTarget.findFirst({
      where: { id, tenantId },
    });
    if (!existing) {
      return respondError(res, "NOT_FOUND", "KPI tidak ditemukan.");
    }

    const parsed = kpiTargetUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    const data = parsed.data;

    // thresholdMinutes only exists on FIRST_RESPONSE; a FIRST_RESPONSE target
    // may not lose its SLA. Its numeric target is not editable at all -
    // it is measurement-only (targetValue is stored as 0).
    if (data.thresholdMinutes !== undefined) {
      if (existing.metric !== "FIRST_RESPONSE") {
        return respondError(
          res,
          "VALIDATION_ERROR",
          "Batas waktu hanya berlaku untuk KPI waktu respons."
        );
      }
      if (data.thresholdMinutes === null) {
        return respondError(
          res,
          "VALIDATION_ERROR",
          "KPI waktu respons memerlukan batas waktu."
        );
      }
    }
    if (
      existing.metric === "FIRST_RESPONSE" &&
      data.targetValue !== undefined &&
      data.targetValue !== 0
    ) {
      return respondError(
        res,
        "VALIDATION_ERROR",
        "KPI waktu respons tidak memakai target angka - sistem menghitung persentasenya otomatis."
      );
    }
    if (
      existing.metric !== "FIRST_RESPONSE" &&
      data.targetValue !== undefined &&
      data.targetValue > 1e9
    ) {
      return respondError(res, "VALIDATION_ERROR", "Target terlalu besar.");
    }

    const updated = await prisma.kpiTarget.update({
      where: { id },
      data: {
        ...(data.targetValue !== undefined ? { targetValue: data.targetValue } : {}),
        ...(data.thresholdMinutes !== undefined ? { thresholdMinutes: data.thresholdMinutes } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
    });
    return res.status(200).json(apiOk(updated));
  });
}
