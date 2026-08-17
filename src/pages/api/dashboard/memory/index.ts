import type { NextApiRequest, NextApiResponse } from "next";
import type { Memory, Prisma } from "@prisma/client";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { paginate, requireTenant, respondError, strQuery } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

type ListResult = {
  items: Memory[];
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
    const agentId = strQuery(req.query, "agentId");
    const where: Prisma.MemoryWhereInput = {
      tenantId,
      ...(agentId ? { agentId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.memory.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }),
      prisma.memory.count({ where }),
    ]);
    return res.status(200).json(apiOk({ items, total, page, pageSize }));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
