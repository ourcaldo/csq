import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@/lib/auth";
import { requireTenant, respondError, strQuery, intQuery, paginate } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { listDealsForKanban, type DealWithRelations } from "@/lib/pipeline";
import type { ListResult } from "@/types/dashboard";

// GET /api/dashboard/pipeline/deals — paginated, filtered deals for the kanban.
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
  const tenantId = requireTenant(session);

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
}
