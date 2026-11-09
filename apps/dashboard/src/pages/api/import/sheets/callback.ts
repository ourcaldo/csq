import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import { requireTenant } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiError } from "@csq/core/types/api";
import { handleOAuthCallback } from "@csq/core/services/sheets";
import { setGoogleCreds } from "@csq/core/lib/google-connect";

// Step 2: Google redirects here with ?code=... Exchange it for tokens and
// store them ON THE TENANT (Tenant.settings.googleSheets) - one Google
// connection per tenant, shared across every spreadsheet. We also create a
// placeholder GOOGLE_SHEETS DataSource (spreadsheet picked next, via
// /sheets/connect) so the UI has a sourceId to bind the spreadsheet selection
// to. This route is hit in-browser after consent, so the NextAuth cookie is
// present - we scope by session, not by the state param.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Metode tidak didukung." } });
    return;
  }

  const session = await getAuthSession(req, res);
  if (!session) {
    res.redirect("/login?error=sheets_auth");
    return;
  }
  // SEC-2 (PRD 16): business-data imports and Google connections are
  // OWNER-only (PRD 18.1).
  if (!requireRole(session, "OWNER")) {
    return res.status(403).json(apiError("PERMISSION_DENIED", "Hanya owner yang dapat mengubah data bisnis."));
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) {
      res.redirect("/dashboard/sources?error=sheets_no_code");
      return;
    }

    try {
      const creds = await handleOAuthCallback(code);
      // Persist the connection at the tenant level (no tokens in DataSource.config).
      await setGoogleCreds(tenantId, creds);
      const source = await prisma.dataSource.create({
        data: {
          tenantId,
          type: "GOOGLE_SHEETS",
          name: "Google Sheets",
          config: {
            spreadsheetId: "",
            sheetName: "",
            mapping: { name: null, price: null, quantity: null },
          },
          status: "INACTIVE",
        },
      });
      res.redirect(`/dashboard/sources?google=connected&sheets_source=${source.id}`);
    } catch {
      res.redirect("/dashboard/sources?error=sheets_callback");
    }
  });
}
