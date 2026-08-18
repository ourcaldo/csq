import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { logAction } from "@/lib/audit";
import { apiError, apiOk, type ApiResponse } from "@/types/api";

// POST /api/dashboard/approvals/[id]/reject — owner rejects a pending action.
// Does NOT execute the action; marks the Approval REJECTED and logs an audit
// entry. OWNER only [FR-AP-005].
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ id: string; status: string }>>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json(apiError("INTERNAL_ERROR", "Method not allowed"));
  }

  const session = await getAuthSession(req, res);
  if (!session) {
    return res.status(401).json(apiError("UNAUTHORIZED", "Authentication required"));
  }
  if (!requireRole(session, "OWNER")) {
    return res
      .status(403)
      .json(apiError("PERMISSION_DENIED", "Only owners can reject actions"));
  }

  const id = typeof req.query.id === "string" ? req.query.id : undefined;
  if (!id) {
    return res.status(400).json(apiError("VALIDATION_ERROR", "Missing approval id"));
  }

  const approval = await prisma.approval.findUnique({ where: { id } });
  if (!approval || approval.tenantId !== session.user.tenantId) {
    return res.status(404).json(apiError("NOT_FOUND", "Approval not found"));
  }
  if (approval.status !== "PENDING") {
    return res
      .status(400)
      .json(apiError("VALIDATION_ERROR", "Approval already resolved"));
  }

  await prisma.approval.update({
    where: { id },
    data: {
      status: "REJECTED",
      resolvedById: session.user.id,
      resolvedAt: new Date(),
    },
  });

  await logAction({
    tenantId: approval.tenantId,
    agentId: approval.agentId,
    action: approval.action,
    entityType: approval.entityType,
    entityId: approval.id,
    approvalStatus: "REJECTED",
  });

  return res.status(200).json(apiOk({ id, status: "REJECTED" }));
}
