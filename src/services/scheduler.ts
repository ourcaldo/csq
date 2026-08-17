import cron from "node-cron";
import { InventorySource } from "@prisma/client";
import prisma from "@/lib/db";
import { applyImport } from "@/lib/import-apply";
import { applyMapping } from "@/services/excel";
import { readSheet } from "@/services/sheets";
import { sheetsSourceConfigSchema } from "@/types/sheets";

// In-process periodic sync for Google Sheets sources (PRD §23A — no Redis/queue,
// node-cron runs inside the Next.js server). Server-only: callers must invoke
// startScheduler() from a server context; it is a no-op on the client.

let started = false;

export function startScheduler(): void {
  if (started) return;
  if (typeof window !== "undefined") return; // never schedule on the client
  started = true;
  // Every 15 minutes.
  cron.schedule("*/15 * * * *", () => {
    void syncAllSheetsSources().catch(() => {
      // Errors are recorded per-source below; swallow top-level failures.
    });
  });
}

async function syncAllSheetsSources(): Promise<void> {
  const sources = await prisma.dataSource.findMany({
    where: { type: "GOOGLE_SHEETS", status: "ACTIVE" },
  });
  for (const source of sources) {
    try {
      await syncOne(source.id, source.tenantId, source.config);
    } catch {
      await prisma.dataSource
        .update({ where: { id: source.id }, data: { status: "ERROR" } })
        .catch(() => undefined);
    }
  }
}

// Exported so the manual sync route (/api/import/sheets/sync) can reuse the
// exact same logic and error handling.
export async function syncOne(
  sourceId: string,
  tenantId: string,
  rawConfig: unknown
): Promise<{ created: number; updated: number; errors: string[] }> {
  // Parse the Json config with Zod — never `as`. A corrupt config throws and
  // is surfaced by the caller as a sync error (DataSource.status = ERROR).
  const config = sheetsSourceConfigSchema.parse(rawConfig);
  const range = config.range || config.sheetName;
  const sheet = await readSheet(config, config.spreadsheetId, range);
  const products = applyMapping(sheet.rows, config.mapping);
  const summary = await applyImport(
    tenantId,
    products,
    InventorySource.GOOGLE_SHEETS,
    config.spreadsheetId
  );

  await prisma.dataSource.update({
    where: { id: sourceId },
    data: { lastSyncAt: new Date(), status: "ACTIVE" },
  });

  return summary;
}
