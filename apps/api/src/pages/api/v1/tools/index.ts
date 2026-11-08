import type { NextApiRequest, NextApiResponse } from "next";
import { requireApiAuth } from "@csq/core/lib/api-auth";
import { assignRequestId } from "@csq/core/lib/request-id";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { listToolSummaries } from "@csq/core/tools";
import type { ToolSummary } from "@csq/core/types/tools";

// GET /api/v1/tools - list registered tools (name/description/category/
// default permission) over the token realm (PRD 23C Phase 7). Any valid token
// (service or API key) may list; summaries are not tenant-scoped.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ToolSummary[]>>
) {
  assignRequestId(req, res);
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));
  }

  const auth = await requireApiAuth(req);
  if (!auth) {
    res.setHeader("WWW-Authenticate", "Bearer");
    return res.status(401).json(apiError("UNAUTHORIZED", "Bearer token required"));
  }

  return res.status(200).json(apiOk(listToolSummaries()));
}
