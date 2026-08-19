import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { provisionAgent } from "@/services/openclaw";
import { requireTenant, respondError, strQuery } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

// Deploy an agent: mark ACTIVE and provision it against the OpenClaw sidecar
// (write openclawCellId + openclawAgentId). OWNER-only, tenant-scoped (plan 6.6).
export type DeployResult = {
  id: string;
  status: string;
  openclawCellId: string;
  openclawAgentId: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<DeployResult>>
) {
  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat men-deploy agent.");
  }
  const tenantId = requireTenant(session);

  const id = strQuery(req.query, "id");
  if (!id) return respondError(res, "VALIDATION_ERROR", "ID agent tidak valid.");

  const agent = await prisma.agent.findFirst({ where: { id, tenantId } });
  if (!agent) return respondError(res, "NOT_FOUND", "Agent tidak ditemukan.");

  // provisionAgent now creates the agent inside the tenant's OpenClaw cell
  // and decides the openclawAgentId itself (no caller-supplied id).
  const result = await provisionAgent({ agentId: agent.id, tenantId });

  return res.status(200).json(apiOk(result));
}
