import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { excelConfirmSchema } from "@/types/import";
import { applyMapping, parseFile } from "@/services/excel";
import { applyImport, type ImportSummary } from "@/lib/import-apply";
import { replaceSourceRows } from "@/lib/source-rows";

// Confirm an Excel/CSV import with the user-corrected mapping. Only dataType
// "produk" gets structured product/inventory import; other types are stored as
// raw rows for source.search. Parses the file again from base64, records a
// DataSource (type EXCEL) for audit/tracking.
type ConfirmResponse = { sourceId: string; summary: ImportSummary };

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

  const parsed = excelConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return respondError(res, "VALIDATION_ERROR", parsed.error.message);
  }

  const { filename, base64, mapping } = parsed.data;
  const dataType = (parsed.data.dataType ?? "produk").trim().toLowerCase();
  const isProduct = dataType === "produk";
  if (isProduct && !mapping) {
    return respondError(res, "VALIDATION_ERROR", "Mapping kolom diperlukan untuk tipe data produk.");
  }
  const buffer = Buffer.from(base64, "base64");
  const sheet = await parseFile(buffer, filename);
  const products = isProduct && mapping ? applyMapping(sheet.rows, mapping) : [];

  let summary: ImportSummary;
  if (isProduct) {
    summary = await applyImport(tenantId, products, "EXCEL", filename);
  } else {
    summary = { created: 0, updated: 0, errors: [] };
  }

  const source = await prisma.dataSource.create({
    data: {
      tenantId,
      type: "EXCEL",
      name: filename,
      dataType,
      config: { mapping: mapping ?? null, dataType, rowCount: sheet.rows.length },
      status: "ACTIVE",
      lastSyncAt: new Date(),
    },
  });

  // Persist the full parsed rows (all columns) for source.search.
  await replaceSourceRows(tenantId, source.id, sheet.rows);

  return res.status(201).json(apiOk({ sourceId: source.id, summary }));
}
