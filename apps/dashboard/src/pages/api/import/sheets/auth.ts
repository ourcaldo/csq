import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@csq/core/lib/auth";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { getAuthUrl } from "@csq/core/services/sheets";

// Step 1 of the Google Sheets OAuth flow: redirect the (authenticated) owner
// to Google's consent screen. state carries the tenantId; the callback also
// re-derives tenant from the session as the authoritative source.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method !== "GET") {
      return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
    }

    const url = getAuthUrl(tenantId);
    res.redirect(url);
  });
}
