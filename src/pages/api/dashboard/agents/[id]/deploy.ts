import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError, strQuery } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

// Deploy an agent: mark it ACTIVE so the agent loop picks it up. OWNER-only,
// tenant-scoped. There is no external runtime to provision — the agent loop
// (services/llm-runtime.ts) drives the configured OpenAI-compatible provider
// directly, so deploying is purely a status flip.
export type DeployResult = {
  id: string;
  status: string;
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

  const updated = await prisma.agent.update({
    where: { id: agent.id },
    data: { status: "ACTIVE" },
    select: { id: true, status: true },
  });

  return res.status(200).json(apiOk(updated));
}
