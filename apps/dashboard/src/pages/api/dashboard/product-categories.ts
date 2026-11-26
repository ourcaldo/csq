import type { NextApiRequest, NextApiResponse } from "next";
import type { ProductCategory } from "@prisma/client";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { productCategoryCreateSchema } from "@csq/core/types/product";

// PRD 32: tenant-defined product categories. GET lists, POST creates
// (inline add from the product composer). Rename/delete deferred.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ProductCategory[] | ProductCategory>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method === "GET") {
      if (!requirePermission(session, "produk.lihat")) {
        return respondError(res, "PERMISSION_DENIED", "Tidak punya akses produk.");
      }
      const items = await prisma.productCategory.findMany({
        where: { tenantId },
        orderBy: { name: "asc" },
      });
      return res.status(200).json(apiOk(items));
    }

    if (req.method === "POST") {
      if (!requirePermission(session, "produk.kelola")) {
        return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat membuat kategori.");
      }
      const parsed = productCategoryCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(res, "VALIDATION_ERROR", parsed.error.message);
      }
      const existing = await prisma.productCategory.findFirst({
        where: { tenantId, name: parsed.data.name },
      });
      if (existing) return res.status(200).json(apiOk(existing));
      const created = await prisma.productCategory.create({
        data: { tenantId, name: parsed.data.name },
      });
      await logHuman({
        tenantId,
        action: "productCategory.create",
        entityType: "ProductCategory",
        entityId: created.id,
        afterValue: created,
      });
      return res.status(201).json(apiOk(created));
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
