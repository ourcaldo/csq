import type { NextApiRequest, NextApiResponse } from "next";
import type { DataSource } from "@prisma/client";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { paginate, requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

type ListResult = {
  items: DataSource[];
  total: number;
  page: number;
  pageSize: number;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ListResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  if (req.method === "GET") {
    const { skip, take, page, pageSize } = paginate(req.query);
    const [items, total] = await Promise.all([
      prisma.dataSource.findMany({
        where: { tenantId },
        skip,
        take,
        orderBy: { createdAt: "desc" },
      }),
      prisma.dataSource.count({ where: { tenantId } }),
    ]);
    return res.status(200).json(apiOk({ items, total, page, pageSize }));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
