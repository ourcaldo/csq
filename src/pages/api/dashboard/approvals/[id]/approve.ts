import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@/lib/auth";
import { executeApprovedAction } from "@/tools/execute";
import { apiError, apiOk, type ApiResponse } from "@/types/api";

// POST /api/dashboard/approvals/[id]/approve — owner approves a pending action.
// Executes the original tool handler (audit stamped APPROVED) and marks the
// Approval resolved. OWNER only [FR-AP-005]. tenantId from the session;
// executeApprovedAction re-checks the approval belongs to this tenant.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json(apiError("INTERNAL_ERROR", "Method not allowed"));
  }

  const session = await getAuthSession(req, res);
  if (!session) {
    return res.status(401).json(apiError("UNAUTHORIZED", "Authentication required"));
  }
  if (session.user.role !== "OWNER") {
    return res
      .status(403)
      .json(apiError("PERMISSION_DENIED", "Only owners can approve actions"));
  }

  const id = typeof req.query.id === "string" ? req.query.id : undefined;
  if (!id) {
    return res.status(400).json(apiError("VALIDATION_ERROR", "Missing approval id"));
  }

  const outcome = await executeApprovedAction({
    approvalId: id,
    tenantId: session.user.tenantId,
    resolvedByUserId: session.user.id,
  });

  switch (outcome.kind) {
    case "ok":
      return res
        .status(200)
        .json(apiOk(outcome.result.data ?? { approved: true }));
    case "not_found":
      return res.status(404).json(apiError("NOT_FOUND", outcome.message));
    case "validation_error":
      return res.status(400).json(apiError("VALIDATION_ERROR", outcome.message));
    case "permission_denied":
      return res
        .status(403)
        .json(apiError("PERMISSION_DENIED", "Approval belongs to another tenant"));
    case "tool_not_found":
      return res
        .status(404)
        .json(apiError("TOOL_NOT_FOUND", "Original tool no longer registered"));
    case "internal_error":
      return res.status(500).json(apiError("INTERNAL_ERROR", outcome.message));
    case "approval_required":
      // Not produced by executeApprovedAction; fall through to a generic error.
      return res
        .status(500)
        .json(apiError("INTERNAL_ERROR", "Unexpected approval state"));
  }
}
