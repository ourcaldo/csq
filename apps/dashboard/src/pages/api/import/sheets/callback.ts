import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import { requireTenant } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiError } from "@csq/core/types/api";
import { handleOAuthCallback } from "@csq/core/services/sheets";
import { setGoogleCreds } from "@csq/core/lib/google-connect";

// Step 2: Google redirects here with ?code=...&state=... Exchange the code
// for tokens and store them ON THE TENANT. The state parameter (the tenantId
// the flow started with, see auth.ts) MUST match the session's tenant
// (audit run-1, sheets-oauth-callback-state-not-validated): without this
// check, any platform owner could hand another tenant's owner a crafted
// ?code= URL and silently bind THEIR Google account to the victim tenant.
// We also find-or-create the placeholder GOOGLE_SHEETS DataSource (was a
// create-per-hit) so refreshes cannot duplicate rows.
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
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!code) {
      res.redirect("/dashboard/sources?error=sheets_no_code");
      return;
    }
    // OAuth state binding: the flow must have been started by THIS tenant.
    if (!state || state !== tenantId) {
      res.redirect("/dashboard/sources?error=sheets_state");
      return;
    }

    try {
      const creds = await handleOAuthCallback(code);
      // Persist the connection at the tenant level (no tokens in DataSource.config).
      await setGoogleCreds(tenantId, creds);
      // Idempotent placeholder: reuse the tenant's existing unbound
      // GOOGLE_SHEETS source instead of creating one per callback hit.
      const source =
        (await prisma.dataSource.findFirst({
          where: { tenantId, type: "GOOGLE_SHEETS" },
          orderBy: { createdAt: "asc" },
        })) ??
        (await prisma.dataSource.create({
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
        }));
      res.redirect(`/dashboard/sources?google=connected&sheets_source=${source.id}`);
    } catch {
      res.redirect("/dashboard/sources?error=sheets_callback");
    }
  });
}
