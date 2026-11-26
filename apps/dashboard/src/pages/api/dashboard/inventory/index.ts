import type { NextApiRequest, NextApiResponse } from "next";
import type { Inventory, Prisma } from "@prisma/client";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { paginate, requireTenant, respondError, strQuery } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

type InventoryWithProduct = Prisma.InventoryGetPayload<{ include: { product: true } }>;
type ListResult = {
  items: InventoryWithProduct[];
  total: number;
  page: number;
  pageSize: number;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Inventory[] | ListResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);
  // Audit run-4 (ungated-list-read): the catalog's read key gates this
  // route - a role without inventaris.lihat must not read this data.
  if (!requirePermission(session, "inventaris.lihat")) {
    return respondError(res, "PERMISSION_DENIED", "Tidak punya akses.");
  }


  return withTenantContext(tenantId, async () => {
    if (req.method === "GET") {
      const { skip, take, page, pageSize } = paginate(req.query);
      const search = strQuery(req.query, "search");
      const where: Prisma.InventoryWhereInput = {
        tenantId,
        // PRD 32: only tracked types (stok / kuota) are listed here; digital
        // products have no quantity.
        product: {
          type: { in: ["PHYSICAL", "COURSE"] },
          ...(search
            ? { name: { contains: search, mode: "insensitive" } }
            : {}),
        },
      };
      const [items, total] = await Promise.all([
        prisma.inventory.findMany({
          where,
          skip,
          take,
          include: { product: true },
          orderBy: { updatedAt: "desc" },
        }),
        prisma.inventory.count({ where }),
      ]);
      return res.status(200).json(apiOk({ items, total, page, pageSize }));
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
