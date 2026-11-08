import type { NextApiRequest, NextApiResponse } from "next";
import type { Memory, Prisma } from "@prisma/client";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { logHuman } from "@/lib/audit";
import { paginate, requireTenant, respondError, strQuery } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { memoryCreateSchema } from "@/types/memory";

type ListResult = {
  items: Memory[];
  total: number;
  page: number;
  pageSize: number;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ListResult | Memory>>
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

  // G4: create a memory from the dashboard. Upsert by (tenant, agent, key) so
  // re-saving a key updates it instead of duplicating.
  if (req.method === "POST") {
    const parsed = memoryCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    const memory = await prisma.memory.upsert({
      where: {
        tenantId_agentId_key: {
          tenantId,
          agentId: parsed.data.agentId,
          key: parsed.data.key,
        },
      },
      create: {
        tenantId,
        agentId: parsed.data.agentId,
        key: parsed.data.key,
        value: parsed.data.value,
        importance: parsed.data.importance ?? "MEDIUM",
        source: "MANUAL",
      },
      update: {
        value: parsed.data.value,
        importance: parsed.data.importance ?? "MEDIUM",
      },
    });
    await logHuman({
      tenantId,
      action: "memory.create",
      entityType: "Memory",
      entityId: memory.id,
      afterValue: memory,
    });
    return res.status(201).json(apiOk(memory));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
