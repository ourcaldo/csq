import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { excelConfirmSchema } from "@/types/import";
import { applyMapping, parseFile } from "@/services/excel";
import { applyImport, type ImportSummary } from "@/lib/import-apply";

// Confirm an Excel/CSV import with the user-corrected mapping. Parses the
// file again from base64, applies the mapping, upserts products + inventory,
// and records a DataSource (type EXCEL) for audit/tracking.
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
  const buffer = Buffer.from(base64, "base64");
  const sheet = await parseFile(buffer, filename);
  const products = applyMapping(sheet.rows, mapping);
  const summary = await applyImport(tenantId, products, "EXCEL", filename);

  const source = await prisma.dataSource.create({
    data: {
      tenantId,
      type: "EXCEL",
      name: filename,
      config: { mapping, rowCount: sheet.rows.length },
      status: "ACTIVE",
    },
  });

  return res.status(201).json(apiOk({ sourceId: source.id, summary }));
}
