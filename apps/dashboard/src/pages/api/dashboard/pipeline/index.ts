import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@csq/core/lib/auth";
import { requireFeatureApi } from "@csq/core/lib/feature-guard";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { getOrCreatePipeline, type PipelineWithStages } from "@csq/core/lib/pipeline";

// GET /api/dashboard/pipeline - the tenant's pipeline + stages. Lazy-seeds the
// default template on first call (so unused tenants carry no empty pipeline). Any
// authenticated member may read.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<PipelineWithStages>>
) {
  if (req.method !== "GET") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");

  if (!(await requireFeatureApi(session, res, "pipeline"))) return;
  const tenantId = requireTenant(session);

  const pipeline = await getOrCreatePipeline(tenantId);
  return res.status(200).json(apiOk(pipeline));
}
