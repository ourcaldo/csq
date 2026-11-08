import type { NextApiRequest, NextApiResponse } from "next";
import type { Inventory, Prisma } from "@prisma/client";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { paginate, requireTenant, respondError, strQuery } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

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

  if (req.method === "GET") {
    const { skip, take, page, pageSize } = paginate(req.query);
    const search = strQuery(req.query, "search");
    const where: Prisma.InventoryWhereInput = {
      tenantId,
      ...(search
        ? { product: { name: { contains: search, mode: "insensitive" } } }
        : {}),
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
}
