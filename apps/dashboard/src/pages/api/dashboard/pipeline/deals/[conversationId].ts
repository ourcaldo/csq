import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import { requireFeatureApi } from "@csq/core/lib/feature-guard";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { requireTenant, respondError, strQuery, HttpError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { setConversationStage, setDealValue } from "@csq/core/lib/pipeline";

// PATCH /api/dashboard/pipeline/deals/[conversationId] - OWNER/STAFF. Move a
// conversation's deal to another stage and/or set its estimated value.
// Body: { stage?, value?, reason? } - at least one of stage/value.
type Result = { dealId: string; stageId?: string; value?: number };

const dealPatchSchema = z
  .object({
    stage: z.string().min(1).optional(),
    value: z.number().int().min(0).max(1_000_000_000_000).optional(),
    reason: z.string().max(300).optional(),
  })
  .refine((v) => v.stage !== undefined || v.value !== undefined, {
    message: "stage atau value wajib diisi.",
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
    return respondError(res, "PERMISSION_DENIED", "Hanya owner/staff yang dapat mengubah deal.");
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
    const { stage, value, reason } = parsed.data;

    try {
      let result: Result | null = null;
      if (stage !== undefined) {
        const moved = await setConversationStage({
          tenantId,
          conversationId,
          stageName: stage,
          movedByUserId: session.user.id,
          reason,
        });
        result = { dealId: moved.dealId, stageId: moved.stageId };
      }
      if (value !== undefined) {
        const valued = await setDealValue({
          tenantId,
          conversationId,
          value,
          movedByUserId: session.user.id,
        });
        result = {
          dealId: valued.dealId,
          value: valued.value,
          ...(result?.stageId ? { stageId: result.stageId } : {}),
        };
      }
      if (!result) {
        return respondError(res, "VALIDATION_ERROR", "Tidak ada perubahan.");
      }
      return res.status(200).json(apiOk(result));
    } catch (err) {
      if (err instanceof HttpError) {
        return respondError(res, err.code, err.message);
      }
      return respondError(res, "INTERNAL_ERROR", "Gagal mengubah deal.");
    }
  });
}
