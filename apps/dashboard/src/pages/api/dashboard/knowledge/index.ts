import type { NextApiRequest, NextApiResponse } from "next";
import type { Knowledge, KnowledgeType, Prisma } from "@prisma/client";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { paginate, requireTenant, respondError, strQuery } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

// String → enum lookup (avoids `as`-narrowing from a Set.has guard).
const TYPE_BY_KEY: Record<string, KnowledgeType> = {
  FAQ: "FAQ",
  POLICY: "POLICY",
  BUSINESS_INFO: "BUSINESS_INFO",
};

type ListResult = {
  items: Knowledge[];
  total: number;
  page: number;
  pageSize: number;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Knowledge[] | ListResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  if (req.method === "GET") {
    const { skip, take, page, pageSize } = paginate(req.query);
    const typeKey = strQuery(req.query, "type");
    const type = typeKey ? TYPE_BY_KEY[typeKey] : undefined;
    const where: Prisma.KnowledgeWhereInput = {
      tenantId,
      ...(type ? { type } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.knowledge.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }),
      prisma.knowledge.count({ where }),
    ]);
    return res.status(200).json(apiOk({ items, total, page, pageSize }));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
