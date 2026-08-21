import cron from "node-cron";
import { InventorySource } from "@prisma/client";
import prisma from "@/lib/db";
import { applyImport } from "@/lib/import-apply";
import { applyMapping } from "@/services/excel";
import { readSheet } from "@/services/sheets";
import { sheetsSourceConfigSchema } from "@/types/sheets";
import { getGoogleCreds } from "@/lib/google-connect";
import { replaceSourceRows } from "@/lib/source-rows";
import { startBaileysChannels, startBaileysHeartbeat } from "@/services/baileys";

// In-process periodic sync for Google Sheets sources (PRD §23A — no Redis/queue,
// node-cron runs inside the Next.js server). Server-only: callers must invoke
// startScheduler() from a server context; it is a no-op on the client.

let started = false;

export function startScheduler(): void {
  if (started) return;
  if (typeof window !== "undefined") return; // never schedule on the client
  started = true;
  // Reconnect any already-CONNECTED Baileys channels (session keys persist on
  // disk, so no re-scan unless logged out). Fire-and-forget.
  void startBaileysChannels().catch(() => undefined);
  // Auto-reconnect Baileys sockets that get killed by the host proxy so
  // inbound messages don't silently drop.
  startBaileysHeartbeat();
  // Every 5 minutes — bounds Sheets data freshness for the agent. The owner
  // can also force a refresh per source via "Sync Sekarang" on the Sumber Data
  // page (hits /api/import/sheets/sync, which reuses syncOne below).
  cron.schedule("*/5 * * * *", () => {
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
  const dataType = (config.dataType ?? "produk").trim().toLowerCase();
  const isProduct = dataType === "produk";
  // OAuth credentials live on the tenant now (lib/google-connect), not in the
  // source config. No creds => treat as a sync error (caller marks ERROR).
  const creds = await getGoogleCreds(tenantId);
  if (!creds) {
    throw new Error("Google account not connected");
  }
  const range = config.range || config.sheetName;
  const sheet = await readSheet(creds, config.spreadsheetId, range);

  // Only "produk" sources get structured product/inventory import. Other types
  // (cabang, staff, ...) are reference data — just refresh the stored rows.
  let summary: { created: number; updated: number; errors: string[] };
  if (isProduct && config.mapping) {
    const products = applyMapping(sheet.rows, config.mapping);
    summary = await applyImport(
      tenantId,
      products,
      InventorySource.GOOGLE_SHEETS,
      config.spreadsheetId
    );
  } else {
    summary = { created: 0, updated: 0, errors: [] };
  }

  await prisma.dataSource.update({
    where: { id: sourceId },
    data: { lastSyncAt: new Date(), status: "ACTIVE" },
  });

  // Refresh the full stored rows so source.search sees the latest sheet content.
  await replaceSourceRows(tenantId, sourceId, sheet.rows);

  return summary;
}
