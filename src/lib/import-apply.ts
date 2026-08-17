import { InventorySource } from "@prisma/client";
import prisma from "@/lib/db";
import type { MappedProduct } from "@/services/excel";

// Shared import applier used by both the Excel confirm route and the Google
// Sheets sync path. Upserts products (by tenant+sku, else tenant+name) and
// their inventory rows. Returns a summary for the dashboard / sync log.

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

  for (const p of products) {
    try {
      const existing = p.sku
        ? await prisma.product.findFirst({ where: { tenantId, sku: p.sku } })
        : await prisma.product.findFirst({ where: { tenantId, name: p.name } });

      const price = p.price.toFixed(2);

      if (existing) {
        await prisma.product.update({
          where: { id: existing.id },
          data: { name: p.name, description: p.description, sku: p.sku, price },
        });
        if (p.stock != null) {
          await prisma.inventory.upsert({
            where: { productId: existing.id },
            create: { tenantId, productId: existing.id, quantity: p.stock, source, sourceRef },
            update: { quantity: p.stock, source, sourceRef },
          });
        }
        updated++;
      } else {
        const product = await prisma.product.create({
          data: { tenantId, name: p.name, description: p.description, sku: p.sku, price },
        });
        if (p.stock != null) {
          await prisma.inventory.upsert({
            where: { productId: product.id },
            create: { tenantId, productId: product.id, quantity: p.stock, source, sourceRef },
            update: { quantity: p.stock, source, sourceRef },
          });
        }
        created++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      errors.push(`${p.name}: ${msg}`);
    }
  }

  return { created, updated, errors };
}
