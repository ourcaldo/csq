import type { NextApiRequest, NextApiResponse } from "next";
import { assignRequestId } from "@csq/core/lib/request-id";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { HttpError, respondError, strQuery } from "@csq/core/lib/queries";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import {
  dealPatchRequestSchema,
  type DealPatchResult,
} from "@csq/core/lib/api-contract";
import { setConversationStage, setDealValue } from "@csq/core/lib/pipeline";
import { requireTenantFeature } from "../_guard";

// PATCH /api/v1/pipeline/deals/[conversationId] (PRD 25) - move a deal's
// stage and/or set its value. Same core functions, history rows, and audit
// trail as the dashboard drawer. At least one of stage / value.

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<DealPatchResult>>
) {
  assignRequestId(req, res);
  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));
  }
  const auth = await requireTenantFeature(req, res, "pipeline", "pipeline-deal");
  if (!auth) return;

  return withTenantContext(auth.tenantId, async () => {
    const conversationId = strQuery(req.query, "conversationId");
    if (!conversationId) {
      return res
        .status(400)
        .json(apiError("VALIDATION_ERROR", "conversationId is required"));
    }
    const parsed = dealPatchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json(
          apiError(
            "VALIDATION_ERROR",
            parsed.error.issues[0]?.message ?? "Invalid request body"
          )
        );
    }
    const { stage, value, reason } = parsed.data;
    // API-key callers have no user; a JWT user's id lands in the audit trail.
    const movedByUserId = auth.kind === "JWT_USER" ? auth.userId : undefined;

    try {
      let result: DealPatchResult | null = null;
      if (stage !== undefined) {
        const moved = await setConversationStage({
          tenantId: auth.tenantId,
          conversationId,
          stageName: stage,
          movedByUserId,
          reason,
        });
        result = { dealId: moved.dealId, stageId: moved.stageId };
      }
      if (value !== undefined) {
        const valued = await setDealValue({
          tenantId: auth.tenantId,
          conversationId,
          value,
          movedByUserId,
        });
        result = {
          dealId: valued.dealId,
          value: valued.value,
          ...(result?.stageId ? { stageId: result.stageId } : {}),
        };
      }
      if (!result) {
        return res
          .status(400)
          .json(apiError("VALIDATION_ERROR", "stage or value is required"));
      }
      return res.status(200).json(apiOk(result));
    } catch (err) {
      if (err instanceof HttpError) {
        return respondError(res, err.code, err.message);
      }
      return res.status(500).json(apiError("INTERNAL_ERROR", "Failed to update deal"));
    }
  });
}
