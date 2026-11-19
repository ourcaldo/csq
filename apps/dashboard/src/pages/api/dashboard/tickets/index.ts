import type { NextApiRequest, NextApiResponse } from "next";
import type { SupportTicket } from "@prisma/client";
import { getAuthSession } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { paginate, requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

type TicketRow = SupportTicket & {
  createdByAgentName: string | null;
  resolvedByName: string | null;
};

type ListResult = {
  items: TicketRow[];
  total: number;
  page: number;
  pageSize: number;
};

// FEA-3 (PRD 16): the tenant's support tickets. OWNER and STAFF can read;
// only OWNER can close a ticket (the [id] route). The agent/resolver names
// are joined manually - SupportTicket has no Prisma relation for them.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ListResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method !== "GET") {
      return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
    }
    const { skip, take, page, pageSize } = paginate(req.query);
    const [rows, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where: { tenantId },
        skip,
        take,
        orderBy: { createdAt: "desc" },
      }),
      prisma.supportTicket.count({ where: { tenantId } }),
    ]);

    // Resolve agent + resolver names for the rows on this page.
    const agentIds = [
      ...new Set(rows.map((t) => t.createdByAgentId).filter((v): v is string => !!v)),
    ];
    const userIds = [
      ...new Set(rows.map((t) => t.resolvedById).filter((v): v is string => !!v)),
    ];
    const [agents, users] = await Promise.all([
      agentIds.length
        ? prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      userIds.length
        ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
        : Promise.resolve([]),
    ]);
    const agentNames = new Map(agents.map((a) => [a.id, a.name]));
    const userNames = new Map(users.map((u) => [u.id, u.name ?? u.email]));

    const items: TicketRow[] = rows.map((t) => ({
      ...t,
      createdByAgentName: t.createdByAgentId ? agentNames.get(t.createdByAgentId) ?? null : null,
      resolvedByName: t.resolvedById ? userNames.get(t.resolvedById) ?? null : null,
    }));
    return res.status(200).json(apiOk({ items, total, page, pageSize }));
  });
}
