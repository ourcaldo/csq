import type { NextApiRequest, NextApiResponse } from "next";
import { requireApiAuth } from "@csq/core/lib/api-auth";
import { assignRequestId } from "@csq/core/lib/request-id";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { getWebhookDiags } from "@csq/core/lib/webhook-diagnostics";

// GET /api/v1/webhook-diag - service-token only. The Meta webhook runs in
// THIS process (PRD 23C Phase 7), so its in-memory diagnostics live here;
// the dashboard BFF proxies this call for the Saluran diagnostics panel.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ items: ReturnType<typeof getWebhookDiags> }>>
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
  if (auth.kind !== "SERVICE") {
    return res
      .status(403)
      .json(apiError("PERMISSION_DENIED", "Service token required"));
  }

  return res.status(200).json(apiOk({ items: getWebhookDiags() }));
}
