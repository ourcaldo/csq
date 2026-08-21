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
import { replaceSourceRows } from "@/lib/source-rows";

// Step 4: confirm the selection for a connected Sheet and run the first
// import. Only dataType "produk" gets structured product/inventory import
// (needs mapping + transactional tools). Other types (cabang, staff, ...) are
// stored as raw rows for source.search — no mapping, no product upsert.
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
  const dataType = (parsed.data.dataType ?? "produk").trim().toLowerCase();
  const isProduct = dataType === "produk";
  if (isProduct && !mapping) {
    return respondError(res, "VALIDATION_ERROR", "Mapping kolom diperlukan untuk tipe data produk.");
  }

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

  let summary: ImportSummary;
  if (isProduct && mapping) {
    const products = applyMapping(sheet.rows, mapping);
    summary = await applyImport(
      tenantId,
      products,
      InventorySource.GOOGLE_SHEETS,
      config.spreadsheetId
    );
  } else {
    // Non-product reference data: no structured import, just raw rows.
    summary = { created: 0, updated: 0, errors: [] };
  }

  await prisma.dataSource.update({
    where: { id: sourceId },
    data: {
      name: name ?? source.name,
      dataType,
      lastSyncAt: new Date(),
      status: "ACTIVE",
      config: { ...config, mapping: mapping ?? null, dataType },
    },
  });

  // Persist the full sheet rows (all columns) for source.search.
  await replaceSourceRows(tenantId, sourceId, sheet.rows);

  return res.status(200).json(apiOk({ summary }));
}
