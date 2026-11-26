import type { NextApiRequest, NextApiResponse } from "next";
import type { Prisma, Product } from "@prisma/client";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { paginate, requireTenant, respondError, strQuery } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import {
  isStockTracked,
  productCreateSchema,
  type ProductTypeValue,
} from "@csq/core/types/product";

// FEA-7 (PRD 16): list rows carry the one-to-one Inventory quantity so the
// products table can show stock; create/update return the bare Product.
// PRD 32: also join the category and course level names, and support
// category/type filters.
const productInclude = {
  inventory: { select: { quantity: true } },
  category: { select: { id: true, name: true } },
  level: { select: { id: true, name: true } },
} satisfies Prisma.ProductInclude;

type ProductWithStock = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

type ListResult = { items: ProductWithStock[]; total: number; page: number; pageSize: number };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Product | ListResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method === "GET") {
      // Audit run-4 (ungated-list-read): produk.lihat gates the catalog read.
      if (!requirePermission(session, "produk.lihat")) {
        return respondError(res, "PERMISSION_DENIED", "Tidak punya akses produk.");
      }
      const { skip, take, page, pageSize } = paginate(req.query);
      const search = strQuery(req.query, "search");
      const categoryId = strQuery(req.query, "categoryId");
      const typeKey = strQuery(req.query, "type");
      const type = (["PHYSICAL", "DIGITAL", "DOWNLOADABLE", "COURSE"] as const).find(
        (t) => t === typeKey
      );
      const where: Prisma.ProductWhereInput = {
        tenantId,
        ...(search
          ? { name: { contains: search, mode: "insensitive" } }
          : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(type ? { type } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.product.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: "desc" },
          include: productInclude,
        }),
        prisma.product.count({ where }),
      ]);
      return res.status(200).json(apiOk({ items, total, page, pageSize }));
    }

    if (req.method === "POST") {
      if (!requirePermission(session, "produk.kelola")) {
        return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat membuat produk.");
      }
      const parsed = productCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(res, "VALIDATION_ERROR", parsed.error.message);
      }
      const { type, ...rest } = parsed.data;
      const productType: ProductTypeValue = type ?? "PHYSICAL";
      // PRD 32: tracked types own an Inventory row from the start (quantity
      // 0; the composer sets it right after), untracked types never do.
      const product = await prisma.product.create({
        data: {
          ...rest,
          type: productType,
          tenantId,
          ...(isStockTracked(productType)
            ? { inventory: { create: { tenantId, quantity: 0, source: "MANUAL" } } }
            : {}),
        },
        include: productInclude,
      });
      await logHuman({
        tenantId,
        action: "product.create",
        entityType: "Product",
        entityId: product.id,
        afterValue: product,
      });
      return res.status(201).json(apiOk(product));
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
