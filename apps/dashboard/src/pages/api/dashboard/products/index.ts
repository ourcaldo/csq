import type { NextApiRequest, NextApiResponse } from "next";
import type { Prisma, Product } from "@prisma/client";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { logHuman } from "@/lib/audit";
import { paginate, requireTenant, respondError, strQuery } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { productCreateSchema } from "@/types/product";

type ListResult = { items: Product[]; total: number; page: number; pageSize: number };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Product | ListResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  if (req.method === "GET") {
    const { skip, take, page, pageSize } = paginate(req.query);
    const search = strQuery(req.query, "search");
    const where: Prisma.ProductWhereInput = {
      tenantId,
      ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.product.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }),
      prisma.product.count({ where }),
    ]);
    return res.status(200).json(apiOk({ items, total, page, pageSize }));
  }

  if (req.method === "POST") {
    if (!requireRole(session, "OWNER")) {
      return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat membuat produk.");
    }
    const parsed = productCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    const product = await prisma.product.create({
      data: { ...parsed.data, tenantId },
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
}
