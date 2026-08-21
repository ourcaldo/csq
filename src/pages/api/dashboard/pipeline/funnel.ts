import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@/lib/auth";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { funnelCounts } from "@/lib/pipeline";

// GET /api/dashboard/pipeline/funnel — per-stage deal counts (+ stage metadata)
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
  const tenantId = requireTenant(session);

  const counts = await funnelCounts(tenantId);
  return res.status(200).json(apiOk(counts));
}
