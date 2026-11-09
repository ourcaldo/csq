import type { NextApiRequest, NextApiResponse } from "next";
import type { Order, OrderStatus, Prisma } from "@prisma/client";
import { getAuthSession } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { paginate, requireTenant, respondError, strQuery } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

type OrderWithItems = Prisma.OrderGetPayload<{
  include: { items: true; refunds: true };
}>;
type ListResult = {
  items: OrderWithItems[];
  total: number;
  page: number;
  pageSize: number;
};

// String → enum lookup (avoids `as`-narrowing from a Set.has guard).
const STATUS_BY_KEY: Record<string, OrderStatus> = {
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  CANCELLED: "CANCELLED",
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ListResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method === "GET") {
      const { skip, take, page, pageSize } = paginate(req.query);
      const statusKey = strQuery(req.query, "status");
      const status = statusKey ? STATUS_BY_KEY[statusKey] : undefined;
      const where: Prisma.OrderWhereInput = {
        tenantId,
        ...(status ? { status } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.order.findMany({
          where,
          skip,
          take,
          include: { items: true, refunds: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.order.count({ where }),
      ]);
      return res.status(200).json(apiOk({ items, total, page, pageSize }));
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
