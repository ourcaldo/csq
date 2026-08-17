import type { NextApiRequest, NextApiResponse } from "next";
import { listToolSummaries } from "@/tools";
import { apiError, apiOk, type ApiResponse } from "@/types/api";
import type { ToolSummary } from "@/types/tools";

// GET /api/tools — list registered tools (name/description/category/default
// permission). Used by OpenClaw config (Phase 6) and the dashboard. Tool
// definitions themselves are not sensitive, so this is unauthenticated; the
// JSON-schema form of parameters is deferred to Phase 6 (YAGNI — no consumer
// yet, and zod-to-json-schema is not a dependency we want to add now).
export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ToolSummary[]>>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json(apiError("INTERNAL_ERROR", "Method not allowed"));
  }
  return res.status(200).json(apiOk(listToolSummaries()));
}
