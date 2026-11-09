import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import { requireFeatureApi } from "@csq/core/lib/feature-guard";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { requireTenant, respondError, strQuery, HttpError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { setConversationStage } from "@csq/core/lib/pipeline";

// PATCH /api/dashboard/pipeline/deals/[conversationId] - OWNER/STAFF. Move a
// conversation's deal to a new stage (human manual change). Body: { stage, reason? }.
type Result = { dealId: string; stageId: string };

const dealPatchSchema = z.object({
  stage: z.string().min(1),
  reason: z.string().max(300).optional(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Result>>
) {
  if (req.method !== "PATCH") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");

  if (!(await requireFeatureApi(session, res, "pipeline"))) return;
  if (!requireRole(session, "OWNER", "STAFF")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner/staff yang dapat mengubah tahap.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const conversationId = strQuery(req.query, "conversationId");
    if (!conversationId) {
      return respondError(res, "VALIDATION_ERROR", "ID percakapan tidak valid.");
    }

    const parsed = dealPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    const { stage, reason } = parsed.data;

    try {
      const result = await setConversationStage({
        tenantId,
        conversationId,
        stageName: stage,
        movedByUserId: session.user.id,
        reason,
      });
      return res.status(200).json(apiOk(result));
    } catch (err) {
      if (err instanceof HttpError) {
        return respondError(res, err.code, err.message);
      }
      return respondError(res, "INTERNAL_ERROR", "Gagal mengubah tahap.");
    }
  });
}
