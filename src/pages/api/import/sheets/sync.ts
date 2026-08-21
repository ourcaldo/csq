import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/db";
import { getAuthSession } from "@/lib/auth";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { syncOne } from "@/services/scheduler";
import { sheetsSyncSchema, sheetsSourceConfigSchema } from "@/types/sheets";
import { getGoogleCreds } from "@/lib/google-connect";
import type { ImportSummary } from "@/lib/import-apply";

// Manual sync trigger for a connected Sheet. Reuses the exact same logic as
// the node-cron periodic sync (scheduler.syncOne) so behavior is identical.
type SyncResponse = { summary: ImportSummary };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<SyncResponse>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const parsed = sheetsSyncSchema.safeParse(req.body);
  if (!parsed.success) {
    return respondError(res, "VALIDATION_ERROR", parsed.error.message);
  }
  const { sourceId } = parsed.data;

  const source = await prisma.dataSource.findFirst({
    where: { id: sourceId, tenantId, type: "GOOGLE_SHEETS" },
  });
  if (!source) return respondError(res, "NOT_FOUND", "Sumber Sheets tidak ditemukan.");

  // Validate config + connection up front so common failures return a specific
  // 4xx instead of a generic 500 (e.g. syncing a placeholder source that was
  // never connected to a spreadsheet, or after the Google account disconnected).
  const configParsed = sheetsSourceConfigSchema.safeParse(source.config);
  if (!configParsed.success || !configParsed.data.spreadsheetId) {
    return respondError(
      res,
      "VALIDATION_ERROR",
      "Sumber belum dikonfigurasi. Pilih spreadsheet dulu sebelum menyinkronkan."
    );
  }
  const creds = await getGoogleCreds(tenantId);
  if (!creds) {
    return respondError(res, "VALIDATION_ERROR", "Akun Google belum terhubung.");
  }

  try {
    const summary = await syncOne(sourceId, tenantId, source.config);
    return res.status(200).json(apiOk({ summary }));
  } catch (err) {
    // Log the real error server-side so it's diagnosable (the old catch swallowed it).
    console.error(`[sheets sync] source ${sourceId} failed:`, err);
    await prisma.dataSource
      .update({ where: { id: sourceId }, data: { status: "ERROR" } })
      .catch(() => undefined);
    const msg = err instanceof Error ? err.message : "Sinkronisasi gagal.";
    return respondError(res, "INTERNAL_ERROR", msg);
  }
}
