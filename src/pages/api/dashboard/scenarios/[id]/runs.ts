import type { NextApiRequest, NextApiResponse } from "next";
import type { ScenarioRun } from "@prisma/client";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { paginate, requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

// Run history for a scenario (OWNER + STAFF). Tenant-scoped. Returns the runs
// newest-first; the builder/UI renders status + last activity per run.

type RunListItem = Pick<
  ScenarioRun,
  "id" | "status" | "currentNodeId" | "resumeAt" | "dedupKey" | "createdAt" | "updatedAt"
> & { conversationId: string };

type ListResult = {
  items: RunListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ListResult>>
) {
  if (req.method !== "GET") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER", "STAFF")) {
    return respondError(res, "PERMISSION_DENIED", "Tidak ada izin.");
  }
  const tenantId = requireTenant(session);

  const { id } = req.query;
  if (typeof id !== "string") {
    return respondError(res, "VALIDATION_ERROR", "ID scenario tidak valid.");
  }

  // Confirm the scenario belongs to this tenant before listing its runs.
  const scenario = await prisma.scenario.findFirst({ where: { id, tenantId } });
  if (!scenario) {
    return respondError(res, "NOT_FOUND", "Scenario tidak ditemukan.");
  }

  const { skip, take, page, pageSize } = paginate(req.query);
  const [items, total] = await Promise.all([
    prisma.scenarioRun.findMany({
      where: { scenarioId: id, tenantId },
      select: {
        id: true,
        status: true,
        currentNodeId: true,
        resumeAt: true,
        dedupKey: true,
        conversationId: true,
        createdAt: true,
        updatedAt: true,
      },
      skip,
      take,
      orderBy: { createdAt: "desc" },
    }),
    prisma.scenarioRun.count({ where: { scenarioId: id, tenantId } }),
  ]);
  return res.status(200).json(apiOk({ items, total, page, pageSize }));
}
