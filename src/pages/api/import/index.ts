import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@/lib/auth";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { excelUploadSchema } from "@/types/import";
import { detectColumns, parseFile } from "@/services/excel";
import { startScheduler } from "@/services/scheduler";

// Excel/CSV upload + column-detection preview. The client sends the file as
// base64 JSON (see src/types/import.ts) so no multipart parser is needed. The
// user corrects the mapping in the dashboard, then POSTs to /api/import/confirm.
type PreviewResponse = {
  headers: string[];
  preview: Record<string, unknown>[];
  mapping: Record<string, string | null>;
  confidence: number;
  rowCount: number;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<PreviewResponse>>
) {
  // Lazy server-side scheduler start — kicks off the Sheets sync cron on the
  // first import request. No-op on the client / once already started.
  startScheduler();

  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const parsed = excelUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return respondError(res, "VALIDATION_ERROR", parsed.error.message);
  }

  const { filename, base64 } = parsed.data;
  const buffer = Buffer.from(base64, "base64");
  const sheet = await parseFile(buffer, filename);
  const { mapping, confidence } = detectColumns(sheet.headers);

  return res.status(200).json(
    apiOk({
      headers: sheet.headers,
      preview: sheet.rows.slice(0, 10),
      mapping,
      confidence,
      rowCount: sheet.rows.length,
    })
  );
}
