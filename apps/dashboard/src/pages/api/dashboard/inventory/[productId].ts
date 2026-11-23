import type { NextApiRequest, NextApiResponse } from "next";
import type { Inventory, InventorySnapshot } from "@prisma/client";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { inventoryUpdateSchema } from "@csq/core/types/inventory";

// FEA-8 (PRD 16): GET returns the per-source snapshots (with confidence) for
// the inventory detail dialog; PUT updates the canonical row.
type SnapshotListResult = { snapshots: InventorySnapshot[] };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Inventory | SnapshotListResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const { productId } = req.query;
    if (typeof productId !== "string") {
      return respondError(res, "VALIDATION_ERROR", "ID produk tidak valid.");
    }

    if (req.method === "GET") {
      const snapshots = await prisma.inventorySnapshot.findMany({
        where: { tenantId, productId },
        orderBy: { updatedAt: "desc" },
      });
      return res.status(200).json(apiOk({ snapshots }));
    }

    if (req.method === "PUT") {
      if (!requirePermission(session, "inventaris.kelola")) {
        return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengubah inventaris.");
      }
      const parsed = inventoryUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(res, "VALIDATION_ERROR", parsed.error.message);
      }
      // Audit run-3 (bff.inventory-upsert-tenant): the upsert keys on the
      // globally-unique productId, so a foreign tenant's product UUID would
      // otherwise claim the key and break the victim's stock/order flows.
      // The product must belong to this tenant, mirroring products/[id].
      const product = await prisma.product.findFirst({
        where: { id: productId, tenantId },
        select: { id: true },
      });
      if (!product) {
        return respondError(res, "NOT_FOUND", "Produk tidak ditemukan dalam tenant ini.");
      }
      // Verify the inventory row belongs to this tenant before mutating;
      // a product just created has no Inventory row yet - upsert it.
      const existing = await prisma.inventory.findFirst({
        where: { productId, tenantId },
      });
      const inventory = await prisma.inventory.upsert({
        where: { productId },
        create: {
          tenantId,
          productId,
          quantity: parsed.data.quantity,
          ...(parsed.data.source ? { source: parsed.data.source } : {}),
          ...(parsed.data.sourceRef ? { sourceRef: parsed.data.sourceRef } : {}),
        },
        update: parsed.data,
      });
      await logHuman({
        tenantId,
        action: "inventory.update",
        entityType: "Inventory",
        entityId: inventory.id,
        beforeValue: existing,
        afterValue: inventory,
      });
      return res.status(200).json(apiOk(inventory));
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
