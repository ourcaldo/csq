import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@csq/core/lib/auth";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { isGoogleConnected } from "@csq/core/lib/google-connect";

// GET /api/dashboard/sources/google - public connection status for the
// dashboard banner/button. Exposes only `connected` + `email`, never tokens.
// Any authenticated member (OWNER or STAFF) may read this.
type GoogleStatusResult = { connected: boolean; email?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<GoogleStatusResult>>
) {
  if (req.method !== "GET") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  const status = await isGoogleConnected(tenantId);
  return res.status(200).json(apiOk(status));
}
