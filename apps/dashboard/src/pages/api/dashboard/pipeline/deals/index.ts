import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@csq/core/lib/auth";
import { requireFeatureApi } from "@csq/core/lib/feature-guard";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { requireTenant, respondError, strQuery, intQuery, paginate } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { listDealsForKanban, type DealWithRelations } from "@csq/core/lib/pipeline";
import type { ListResult } from "@csq/core/types/dashboard";

// GET /api/dashboard/pipeline/deals - paginated, filtered deals for the kanban.
// Filters: ?stage=&assignee=&tag=&page=&pageSize=. Any authenticated member.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ListResult<DealWithRelations>>>
) {
  if (req.method !== "GET") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");

  if (!(await requireFeatureApi(session, res, "pipeline"))) return;
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const { page, pageSize } = paginate(req.query);
    const stageId = strQuery(req.query, "stage");
    const assigneeUserId = strQuery(req.query, "assignee");
    const tagId = strQuery(req.query, "tag");
    const from = strQuery(req.query, "from");
    const to = strQuery(req.query, "to");

    const result = await listDealsForKanban({
      tenantId,
      stageId,
      assigneeUserId,
      tagId,
      from,
      to,
      page,
      pageSize,
    });
    return res.status(200).json(apiOk(result));
  });
}
