import type { NextApiRequest, NextApiResponse } from "next";
import { assignRequestId } from "@csq/core/lib/request-id";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { getOrCreatePipeline } from "@csq/core/lib/pipeline";
import { requireTenantFeature } from "./_guard";

// GET /api/v1/pipeline/stages (PRD 25) - the tenant's stages so callers can
// discover valid stage names before moving a deal.

type Result = { items: { id: string; name: string; kind: string; order: number }[] };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Result>>
) {
  assignRequestId(req, res);
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));
  }
  const auth = await requireTenantFeature(req, res, "pipeline", "pipeline-stages");
  if (!auth) return;

  return withTenantContext(auth.tenantId, async () => {
    const pipeline = await getOrCreatePipeline(auth.tenantId);
    return res.status(200).json(
      apiOk({
        items: pipeline.stages.map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.kind,
          order: s.order,
        })),
      })
    );
  });
}
