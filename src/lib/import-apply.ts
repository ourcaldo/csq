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
// G9: every mutation is tenant-gated (compound unique on Inventory;
// updateMany + count assert on Product, which has no compound unique).

export type ImportSummary = {
  created: number;
  updated: number;
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

  // Read the tenant's source priority once for the whole import (PRD §13).
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const priority = tenant ? readSourcePriority(tenant.settings) : ["MANUAL", "EXCEL", "GOOGLE_SHEETS"];

  for (const p of products) {
    try {
      const existing = p.sku
        ? await prisma.product.findFirst({ where: { tenantId, sku: p.sku } })
        : await prisma.product.findFirst({ where: { tenantId, name: p.name } });

      const price = p.price.toFixed(2);

      let productId: string;
      if (existing) {
        // G9: tenant-gated product update (no compound unique on Product).
        const res = await prisma.product.updateMany({
          where: { id: existing.id, tenantId },
          data: { name: p.name, description: p.description, sku: p.sku, price },
        });
        if (res.count !== 1) throw new Error("Product vanished during import");
        productId = existing.id;
        updated++;
      } else {
        const product = await prisma.product.create({
          data: { tenantId, name: p.name, description: p.description, sku: p.sku, price },
        });
        productId = product.id;
        created++;
      }

      if (p.stock != null) {
        // G8: record this source's contribution as a per-source snapshot.
        await prisma.inventorySnapshot.upsert({
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
        const snapshots = await prisma.inventorySnapshot.findMany({
          where: { tenantId, productId },
          orderBy: { updatedAt: "desc" },
        });
        const resolved = resolveInventoryBySnapshots(snapshots, priority);
        if (resolved) {
          // G9: compound unique selector on the canonical Inventory row.
          await prisma.inventory.upsert({
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      errors.push(`${p.name}: ${msg}`);
    }
  }

  return { created, updated, errors };
}
