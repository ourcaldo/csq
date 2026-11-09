import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { strQuery } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";

type ApprovalSummary = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  status: string;
  proposedBefore: unknown;
  proposedAfter: unknown;
  createdAt: string;
};

// GET /api/dashboard/approvals - approvals for the tenant. OWNER only
// [FR-AP-004]. tenantId from the session, never the query string.
// ?status=PENDING (default) returns the open work queue, oldest first.
// ?status=RESOLVED (FEA-6, PRD 16) returns APPROVED+REJECTED history,
// newest first, capped at 100.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ApprovalSummary[]>>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json(apiError("INTERNAL_ERROR", "Method not allowed"));
  }

  const session = await getAuthSession(req, res);
  if (!session) {
    return res.status(401).json(apiError("UNAUTHORIZED", "Authentication required"));
  }
  if (!requireRole(session, "OWNER")) {
    return res
      .status(403)
      .json(apiError("PERMISSION_DENIED", "Only owners can manage approvals"));
  }

  const tenantId = session.user.tenantId;

  return withTenantContext(tenantId, async () => {
    const resolved = strQuery(req.query, "status") === "RESOLVED";
    const approvals = await prisma.approval.findMany({
      where: {
        tenantId,
        status: resolved ? { in: ["APPROVED", "REJECTED"] } : "PENDING",
      },
      orderBy: { createdAt: resolved ? "desc" : "asc" },
      take: resolved ? 100 : undefined,
    });

    const data: ApprovalSummary[] = approvals.map((a) => ({
      id: a.id,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      status: a.status,
      proposedBefore: a.proposedBefore,
      proposedAfter: a.proposedAfter,
      createdAt: a.createdAt.toISOString(),
    }));
    return res.status(200).json(apiOk(data));
  });
}
