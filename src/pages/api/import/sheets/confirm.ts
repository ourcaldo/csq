import type { NextApiRequest, NextApiResponse } from "next";
import { InventorySource } from "@prisma/client";
import prisma from "@/lib/db";
import { getAuthSession } from "@/lib/auth";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { applyMapping } from "@/services/excel";
import { readSheet } from "@/services/sheets";
import { applyImport, type ImportSummary } from "@/lib/import-apply";
import { sheetsConfirmSchema, sheetsSourceConfigSchema } from "@/types/sheets";
import { getGoogleCreds } from "@/lib/google-connect";

// Step 4: confirm the mapping for a connected Sheet, run the first import,
// and persist the mapping into DataSource.config.
type ConfirmResponse = { summary: ImportSummary };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ConfirmResponse>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const parsed = sheetsConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return respondError(res, "VALIDATION_ERROR", parsed.error.message);
  }
  const { sourceId, name, mapping } = parsed.data;

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
  const range = config.range || config.sheetName;
  const sheet = await readSheet(creds, config.spreadsheetId, range);
  const products = applyMapping(sheet.rows, mapping);
  const summary = await applyImport(
    tenantId,
    products,
    InventorySource.GOOGLE_SHEETS,
    config.spreadsheetId
  );

  await prisma.dataSource.update({
    where: { id: sourceId },
    data: {
      name: name ?? source.name,
      lastSyncAt: new Date(),
      status: "ACTIVE",
      config: { ...config, mapping },
    },
  });

  return res.status(200).json(apiOk({ summary }));
}
