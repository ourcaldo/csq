import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@csq/core/lib/auth";
import { requireRole } from "@csq/core/lib/auth";
import { respondError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { getWebhookDiags } from "@csq/core/lib/webhook-diagnostics";

// Owner-only diagnostic read-out for the WhatsApp webhook: the recent reasons
// inbound POSTs were rejected (SIG_MISMATCH / NO_SECRET / UNKNOWN_PHONE_ID).
// Memory-only, capped, resets on redeploy - for live diagnosis, not an audit log.

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ items: ReturnType<typeof getWebhookDiags> }>>
): Promise<void> {
  if (req.method !== "GET") {
    respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
    return;
  }
  const session = await getAuthSession(req, res);
  if (!session) {
    respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
    return;
  }
  if (!requireRole(session, "OWNER")) {
    respondError(res, "PERMISSION_DENIED", "Hanya owner.");
    return;
  }
  res.status(200).json(apiOk({ items: getWebhookDiags() }));
}
