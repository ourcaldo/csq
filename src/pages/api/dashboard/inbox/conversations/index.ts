import type { NextApiRequest, NextApiResponse } from "next";
import type { ConversationStatus, Prisma } from "@prisma/client";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { paginate, requireTenant, respondError, strQuery } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

type Item = Prisma.ConversationGetPayload<{
  include: {
    contact: true;
    assignedAgent: true;
    assignee: true;
    tags: { include: { tag: true } };
  };
}>;
type ListResult = {
  items: Item[];
  total: number;
  page: number;
  pageSize: number;
};

// String → enum lookup (avoids `as`-narrowing from a Set.has guard).
const STATUS_BY_KEY: Record<string, ConversationStatus> = {
  OPEN: "OPEN",
  PENDING: "PENDING",
  RESOLVED: "RESOLVED",
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
    const statusKey = strQuery(req.query, "status");
    const status = statusKey ? STATUS_BY_KEY[statusKey] : undefined;
    const assignedAgentId = strQuery(req.query, "assignedAgentId");
    const assigneeUserId = strQuery(req.query, "assigneeUserId");
    const search = strQuery(req.query, "search");

    const where: Prisma.ConversationWhereInput = {
      tenantId,
      ...(status ? { status } : {}),
      ...(assignedAgentId ? { assignedAgentId } : {}),
      ...(assigneeUserId ? { assigneeUserId } : {}),
      ...(search ? { customerPhone: { contains: search } } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        skip,
        take,
        include: {
          contact: true,
          assignedAgent: true,
          assignee: true,
          tags: { include: { tag: true } },
        },
        orderBy: { lastMessageAt: "desc" },
      }),
      prisma.conversation.count({ where }),
    ]);
    return res.status(200).json(apiOk({ items, total, page, pageSize }));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
