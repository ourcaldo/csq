import type { NextApiRequest, NextApiResponse } from "next";
import type { Scenario } from "@prisma/client";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { logHuman } from "@/lib/audit";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

// Pause an active scenario (ACTIVE → PAUSED). OWNER-only. Existing runs in
// flight finish; no new runs start until re-activated.

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Scenario>>
) {
  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat menjeda scenario.");
  }
  const tenantId = requireTenant(session);

  const { id } = req.query;
  if (typeof id !== "string") {
    return respondError(res, "VALIDATION_ERROR", "ID scenario tidak valid.");
  }

  const existing = await prisma.scenario.findFirst({ where: { id, tenantId } });
  if (!existing) {
    return respondError(res, "NOT_FOUND", "Scenario tidak ditemukan.");
  }

  const paused = await prisma.scenario.update({
    where: { id },
    data: { status: "PAUSED" },
  });
  await logHuman({
    tenantId,
    action: "scenario.pause",
    entityType: "Scenario",
    entityId: id,
    afterValue: { name: paused.name },
  });
  return res.status(200).json(apiOk(paused));
}
