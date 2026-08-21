import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@/lib/auth";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { getGoogleCreds } from "@/lib/google-connect";
import prisma from "@/lib/db";

// POST /api/dashboard/sources/sheets/create — OWNER only. Creates a placeholder
// GOOGLE_SHEETS DataSource (empty spreadsheetId) bound to the tenant's existing
// Google connection, so the owner can add another spreadsheet WITHOUT
// re-logging-in. The spreadsheet is picked next via /api/import/sheets/connect.
// Requires the tenant to already be connected (400 otherwise).
type CreateResult = { id: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<CreateResult>>
) {
  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat menambah spreadsheet.");
  }
  const tenantId = requireTenant(session);

  const creds = await getGoogleCreds(tenantId);
  if (!creds) {
    return respondError(res, "VALIDATION_ERROR", "Akun Google belum terhubung. Sambungkan dulu.");
  }

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

  return res.status(201).json(apiOk({ id: source.id }));
}
