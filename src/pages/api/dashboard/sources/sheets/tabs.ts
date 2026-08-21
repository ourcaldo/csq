import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@/lib/auth";
import { requireTenant, respondError, strQuery } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { getGoogleCreds } from "@/lib/google-connect";
import { listSheets } from "@/services/sheets";

// GET /api/dashboard/sources/sheets/tabs?spreadsheetId=X — list the tab titles
// inside a spreadsheet, so the owner can pick which tab to import. Uses the
// tenant's stored tokens (no re-login). 400 when not connected or missing id.
type TabsResult = { tabs: string[] };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<TabsResult>>
) {
  if (req.method !== "GET") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  const spreadsheetId = strQuery(req.query, "spreadsheetId");
  if (!spreadsheetId) {
    return respondError(res, "VALIDATION_ERROR", "Parameter spreadsheetId diperlukan.");
  }

  const creds = await getGoogleCreds(tenantId);
  if (!creds) {
    return respondError(res, "VALIDATION_ERROR", "Akun Google belum terhubung.");
  }
  try {
    const tabs = await listSheets(creds, spreadsheetId);
    return res.status(200).json(apiOk({ tabs }));
  } catch {
    return respondError(res, "INTERNAL_ERROR", "Gagal mengambil daftar tab dari spreadsheet.");
  }
}
