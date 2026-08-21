import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@/lib/auth";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { getOrCreatePipeline, type PipelineWithStages } from "@/lib/pipeline";

// GET /api/dashboard/pipeline — the tenant's pipeline + stages. Lazy-seeds the
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
  const tenantId = requireTenant(session);

  const pipeline = await getOrCreatePipeline(tenantId);
  return res.status(200).json(apiOk(pipeline));
}
