import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError, strQuery } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

// Pause an agent: set status PAUSED so the agent loop stands down for its
// conversations (runAgentReply skips non-ACTIVE agents). OWNER-only,
// tenant-scoped (plan 6.6).
export type PauseResult = { id: string; status: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<PauseResult>>
) {
  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat menjeda agent.");
  }
  const tenantId = requireTenant(session);

  const id = strQuery(req.query, "id");
  if (!id) return respondError(res, "VALIDATION_ERROR", "ID agent tidak valid.");

  const agent = await prisma.agent.findFirst({ where: { id, tenantId } });
  if (!agent) return respondError(res, "NOT_FOUND", "Agent tidak ditemukan.");

  const updated = await prisma.agent.update({
    where: { id: agent.id },
    data: { status: "PAUSED" },
    select: { id: true, status: true },
  });

  return res.status(200).json(apiOk(updated));
}
