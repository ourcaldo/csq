import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { getTenantEntitlements } from "@csq/core/lib/entitlements";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { kpiTargetCreateSchema } from "@csq/core/types/kpi";

// KPI targets (PRD 17): OWNER-only management. GET lists all targets with
// the staff name; POST creates one. Editing lives in targets/[id].ts.
//
// Caps and gates enforced here (not the schema): max 5 active per holder
// (the tenant, or each staff member), DEALS_WON requires the pipeline plan
// feature, ORDERS is tenant-scope only (validated in the Zod schema).

const MAX_ACTIVE_PER_HOLDER = 5;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengatur KPI.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method === "GET") {
      const targets = await prisma.kpiTarget.findMany({
        where: { tenantId },
        include: { user: { select: { name: true, email: true } } },
        orderBy: [{ scope: "asc" }, { createdAt: "asc" }],
      });
      const items = targets.map(({ user, ...t }) => ({
        ...t,
        userName: user?.name ?? user?.email ?? null,
      }));
      return res.status(200).json(apiOk({ items }));
    }

    if (req.method === "POST") {
      const parsed = kpiTargetCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(res, "VALIDATION_ERROR", parsed.error.message);
      }
      const data = parsed.data;

      // The staff member must belong to this tenant.
      if (data.userId) {
        const member = await prisma.user.findFirst({
          where: { id: data.userId, tenantId },
          select: { id: true },
        });
        if (!member) {
          return respondError(
            res,
            "VALIDATION_ERROR",
            "Anggota tim tidak ditemukan dalam tenant ini."
          );
        }
      }

      // DEALS_WON measures pipeline moves - meaningless without the feature.
      if (data.metric === "DEALS_WON") {
        const entitlements = await getTenantEntitlements(tenantId);
        if (!entitlements.features.includes("pipeline")) {
          return respondError(
            res,
            "PERMISSION_DENIED",
            "KPI deal menang memerlukan fitur Pipeline pada paket Anda."
          );
        }
      }

      // Max 5 active per holder (the tenant, or this staff member).
      const activeCount = await prisma.kpiTarget.count({
        where: {
          tenantId,
          active: true,
          ...(data.scope === "USER"
            ? { scope: "USER", userId: data.userId }
            : { scope: "TENANT" }),
        },
      });
      if (activeCount >= MAX_ACTIVE_PER_HOLDER) {
        return respondError(
          res,
          "VALIDATION_ERROR",
          `Maksimum ${MAX_ACTIVE_PER_HOLDER} KPI aktif per ${data.scope === "USER" ? "anggota tim" : "tenant"}.`
        );
      }

      const created = await prisma.kpiTarget.create({
        data: {
          tenantId,
          scope: data.scope,
          userId: data.scope === "USER" ? data.userId : null,
          metric: data.metric,
          period: data.period,
          thresholdMinutes: data.metric === "FIRST_RESPONSE" ? data.thresholdMinutes : null,
          targetValue: data.targetValue,
          active: true,
        },
      });
      return res.status(201).json(apiOk(created));
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}

// Keep z import shape consistent with other routes (schema lives in types).
export type KpiTargetsBody = z.infer<typeof kpiTargetCreateSchema>;
