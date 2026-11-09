import type { NextApiRequest, NextApiResponse } from "next";
import type { Inventory } from "@prisma/client";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { inventoryUpdateSchema } from "@csq/core/types/inventory";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Inventory>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const { productId } = req.query;
    if (typeof productId !== "string") {
      return respondError(res, "VALIDATION_ERROR", "ID produk tidak valid.");
    }

    if (req.method === "PUT") {
      if (!requireRole(session, "OWNER")) {
        return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengubah inventaris.");
      }
      const parsed = inventoryUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(res, "VALIDATION_ERROR", parsed.error.message);
      }
      // Verify the inventory row belongs to this tenant before mutating.
      const existing = await prisma.inventory.findFirst({
        where: { productId, tenantId },
      });
      if (!existing) {
        return respondError(res, "NOT_FOUND", "Inventaris tidak ditemukan.");
      }
      const inventory = await prisma.inventory.update({
        where: { productId },
        data: parsed.data,
      });
      await logHuman({
        tenantId,
        action: "inventory.update",
        entityType: "Inventory",
        entityId: existing.id,
        beforeValue: existing,
        afterValue: inventory,
      });
      return res.status(200).json(apiOk(inventory));
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
