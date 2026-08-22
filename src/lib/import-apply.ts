import { InventorySource, Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import type { MappedProduct } from "@/services/excel";
import {
  readSourcePriority,
  resolveInventoryBySnapshots,
} from "@/lib/source-priority";

// Shared import applier used by both the Excel confirm route and the Google
// Sheets sync path. Upserts products (by tenant+sku, else tenant+name) and
// their inventory rows, and writes a per-source InventorySnapshot (G8) so
// Tenant.settings.sourcePriority can arbitrate conflicts between sources. The
// canonical Inventory row is recomputed from the snapshots by priority, so a
// lower-priority source import no longer overwrites a higher-priority source's
// quantity. Returns a summary for the dashboard / sync log.
//
// G9: every mutation is tenant-gated (compound unique on Inventory; compound
// unique on Product (tenantId, sku) via M13, plus updateMany + count assert
// for defense in depth).

export type ImportSummary = {
  created: number;
  updated: number;
  // Rows dropped before the atomic write (Zod-rejected by the caller's
  // applyMapping, or duplicate SKUs within the batch deduplicated here).
  // Optional for backward compat with callers that build literals without it.
  skipped?: number;
  errors: string[];
};

export async function applyImport(
  tenantId: string,
  products: MappedProduct[],
  source: InventorySource,
  sourceRef?: string
): Promise<ImportSummary> {
  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  // Pre-transaction validation: drop duplicate (tenantId, sku) / (tenantId,
  // name) keys within this batch so the atomic write below cannot self-conflict
  // on the Product unique index (M13). Last occurrence wins; earlier dupes are
  // counted as skipped and never reach the transaction.
  const seen = new Map<string, MappedProduct>();
  let dedupSkipped = 0;
  for (const p of products) {
    const key = p.sku ? `sku:${p.sku}` : `name:${p.name}`;
    if (seen.has(key)) dedupSkipped++;
    seen.set(key, p);
  }
  const valid = Array.from(seen.values());

  // Read the tenant's source priority once for the whole import (PRD §13).
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const priority = tenant ? readSourcePriority(tenant.settings) : ["MANUAL", "EXCEL", "GOOGLE_SHEETS"];

  // Atomic: every product upsert + snapshot + canonical recompute runs in one
  // $transaction so a crash mid-import rolls back the whole batch (preferable
  // to a partial import). Per-row validation already happened above, so any
  // failure inside is fatal — we record it and zero the counters since nothing
  // was committed.
  try {
    await prisma.$transaction(async (tx) => {
      for (const p of valid) {
        // (tenantId, sku) is unique (M13); skuless products fall back to name.
        const existing = p.sku
          ? await tx.product.findFirst({ where: { tenantId, sku: p.sku } })
          : await tx.product.findFirst({ where: { tenantId, name: p.name } });

        const price = p.price.toFixed(2);

        let productId: string;
        if (existing) {
          // G9: tenant-gated product update (defense in depth even with the
          // compound unique on Product from M13).
          const res = await tx.product.updateMany({
            where: { id: existing.id, tenantId },
            data: { name: p.name, description: p.description, sku: p.sku, price },
          });
          if (res.count !== 1) throw new Error(`Product vanished during import: ${p.name}`);
          productId = existing.id;
          updated++;
        } else {
          const product = await tx.product.create({
            data: { tenantId, name: p.name, description: p.description, sku: p.sku, price },
          });
          productId = product.id;
          created++;
        }

        if (p.stock != null) {
          // G8: record this source's contribution as a per-source snapshot.
          await tx.inventorySnapshot.upsert({
            where: { tenantId_productId_source: { tenantId, productId, source } },
            create: {
              tenantId,
              productId,
              source,
              quantity: p.stock,
              sourceRef,
              syncedAt: new Date(),
            },
            update: {
              quantity: p.stock,
              sourceRef,
              syncedAt: new Date(),
            },
          });

          // Recompute the canonical quantity by priority across all snapshots
          // for this product, then write it to the single Inventory row.
          const snapshots = await tx.inventorySnapshot.findMany({
            where: { tenantId, productId },
            orderBy: { updatedAt: "desc" },
          });
          const resolved = resolveInventoryBySnapshots(snapshots, priority);
          if (resolved) {
            // G9: compound unique selector on the canonical Inventory row.
            await tx.inventory.upsert({
              where: { tenantId_productId: { tenantId, productId } },
              create: {
                tenantId,
                productId,
                quantity: resolved.quantity,
                source: resolved.source,
                sourceRef: resolved.sourceRef,
              },
              update: {
                quantity: resolved.quantity,
                source: resolved.source,
                sourceRef: resolved.sourceRef,
              },
            });
          }
        }
      }
    });
  } catch (err) {
    // Fatal: the whole batch rolled back. Counters are zeroed since nothing was
    // committed; the error is surfaced in the summary for the caller.
    const msg = err instanceof Error ? err.message : "Unknown error";
    errors.push(`Import rolled back: ${msg}`);
    created = 0;
    updated = 0;
  }

  return { created, updated, skipped: dedupSkipped, errors };
}
