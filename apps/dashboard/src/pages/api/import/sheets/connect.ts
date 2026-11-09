import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { detectColumns } from "@csq/core/services/excel";
import { readSheet } from "@csq/core/services/sheets";
import { sheetsConnectSchema, sheetsSourceConfigSchema } from "@csq/core/types/sheets";
import { getGoogleCreds } from "@csq/core/lib/google-connect";

// Step 3: after OAuth, the owner picks a spreadsheet + sheet. We read the
// first rows, detect columns, persist the selection into DataSource.config,
// and return a mapping preview for the user to confirm.
type ConnectResponse = {
  headers: string[];
  preview: Record<string, unknown>[];
  mapping: Record<string, string | null>;
  confidence: number;
  rowCount: number;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ConnectResponse>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  // SEC-2 (PRD 16): business-data imports and Google connections are
  // OWNER-only (PRD 18.1).
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengubah data bisnis.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method !== "POST") {
      return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
    }

    const parsed = sheetsConnectSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    const { sourceId, spreadsheetId, sheetName, range } = parsed.data;

    const source = await prisma.dataSource.findFirst({
      where: { id: sourceId, tenantId, type: "GOOGLE_SHEETS" },
    });
    if (!source) return respondError(res, "NOT_FOUND", "Sumber Sheets tidak ditemukan.");

    // OAuth credentials live on the tenant now, not in DataSource.config.
    const creds = await getGoogleCreds(tenantId);
    if (!creds) {
      return respondError(res, "VALIDATION_ERROR", "Akun Google belum terhubung. Sambungkan dulu.");
    }
    const config = sheetsSourceConfigSchema.parse(source.config);
    const readRange = range || sheetName;
    const sheet = await readSheet(creds, spreadsheetId, readRange);
    const { mapping, confidence } = detectColumns(sheet.headers);

    await prisma.dataSource.update({
      where: { id: sourceId },
      data: {
        name: sheetName,
        config: { ...config, spreadsheetId, sheetName, range },
      },
    });

    return res.status(200).json(
      apiOk({
        headers: sheet.headers,
        preview: sheet.rows.slice(0, 10),
        mapping,
        confidence,
        rowCount: sheet.rows.length,
      })
    );
  });
}
