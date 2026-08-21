import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@/lib/auth";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { getGoogleCreds } from "@/lib/google-connect";
import { listSpreadsheets } from "@/services/sheets";
import type { SpreadsheetRef } from "@/types/sheets";

// GET /api/dashboard/sources/spreadsheets — list the connected Google user's
// spreadsheets so the owner can pick one (no re-login; uses the tenant's
// stored tokens). Any authenticated member may list. 400 when not connected.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<SpreadsheetRef[]>>
) {
  if (req.method !== "GET") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  const creds = await getGoogleCreds(tenantId);
  if (!creds) {
    return respondError(res, "VALIDATION_ERROR", "Akun Google belum terhubung.");
  }
  try {
    const refs = await listSpreadsheets(creds);
    return res.status(200).json(apiOk(refs));
  } catch {
    return respondError(res, "INTERNAL_ERROR", "Gagal mengambil daftar spreadsheet dari Google.");
  }
}
