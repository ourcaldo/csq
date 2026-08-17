import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@/lib/auth";
import { parseFile, detectColumns, type ColumnMapping } from "@/services/excel";
import { excelUploadSchema } from "@/types/import";
import { apiError, apiOk, type ApiResponse } from "@/types/api";

type PreviewResponse = {
  headers: string[];
  mapping: ColumnMapping;
  confidence: number;
  previewRows: Record<string, unknown>[];
};

// Step 1: parse the uploaded Excel/CSV and return a column-mapping preview for
// the owner to confirm. File arrives as base64 JSON (no multipart parser).
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<PreviewResponse>>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json(apiError("INTERNAL_ERROR", "Method not allowed"));
  }

  const session = await getAuthSession(req, res);
  if (!session) return res.status(401).json(apiError("UNAUTHORIZED", "Masuk dulu."));

  const parsed = excelUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input"));
  }

  const { filename, base64 } = parsed.data;
  const buffer = Buffer.from(base64, "base64");
  const { headers, rows } = await parseFile(buffer, filename);
  const { mapping, confidence } = detectColumns(headers);

  return res.status(200).json(
    apiOk({ headers, mapping, confidence, previewRows: rows.slice(0, 5) })
  );
}
