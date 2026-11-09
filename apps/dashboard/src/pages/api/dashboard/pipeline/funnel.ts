import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@csq/core/lib/auth";
import { requireFeatureApi } from "@csq/core/lib/feature-guard";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { funnelCounts } from "@csq/core/lib/pipeline";

// GET /api/dashboard/pipeline/funnel - per-stage deal counts (+ stage metadata)
// for the funnel cone view and conversion rates. Any authenticated member.
type FunnelStage = {
  stageId: string;
  name: string;
  order: number;
  kind: "OPENING" | "WON" | "LOST" | "NORMAL";
  count: number;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<FunnelStage[]>>
) {
  if (req.method !== "GET") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");

  if (!(await requireFeatureApi(session, res, "pipeline"))) return;
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const counts = await funnelCounts(tenantId);
    return res.status(200).json(apiOk(counts));
  });
}
