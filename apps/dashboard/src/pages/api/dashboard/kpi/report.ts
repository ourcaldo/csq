import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { computeCurrentPeriod } from "@csq/core/lib/kpi";
import type { KpiReportRow } from "@csq/core/types/kpi";

// KPI report (PRD 17): per active target, the live current period (computed
// on load - never snapshotted) plus the closed-period history (newest
// first). OWNER-only. Inactive targets are not reported; their history
// stays queryable through the targets list + snapshots if ever needed.

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ items: KpiReportRow[] }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat melihat laporan KPI.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method !== "GET") {
      return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
    }

    const targets = await prisma.kpiTarget.findMany({
      where: { tenantId, active: true },
      include: { user: { select: { name: true, email: true } } },
      orderBy: [{ scope: "asc" }, { createdAt: "asc" }],
    });

    const items: KpiReportRow[] = [];
    for (const target of targets) {
      const current = await computeCurrentPeriod(target);
      const snapshots = await prisma.kpiSnapshot.findMany({
        where: { kpiTargetId: target.id },
        orderBy: { periodKey: "desc" },
        take: 24,
      });
      const progress =
        target.targetValue > 0
          ? Math.min(100, (current.actual.value / target.targetValue) * 100)
          : 0;
      items.push({
        id: target.id,
        scope: target.scope,
        userId: target.userId,
        userName: target.user?.name ?? target.user?.email ?? null,
        metric: target.metric,
        period: target.period,
        thresholdMinutes: target.thresholdMinutes,
        targetValue: target.targetValue,
        active: target.active,
        current: {
          key: current.key,
          start: current.start.toISOString(),
          end: current.end.toISOString(),
          actual: current.actual.value,
          meta: current.actual.meta,
          progress,
          achieved: current.actual.value >= target.targetValue,
        },
        history: snapshots.map((s) => ({
          key: s.periodKey,
          start: s.periodStart.toISOString(),
          end: s.periodEnd.toISOString(),
          actual: s.actualValue,
          target: s.targetValue,
          achieved: s.achieved,
        })),
      });
    }

    return res.status(200).json(apiOk({ items }));
  });
}
