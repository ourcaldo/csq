import type { NextApiRequest, NextApiResponse } from "next";
import type { SupportTicket } from "@prisma/client";
import { getAuthSession } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { paginate, requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

type ListResult = {
  items: SupportTicket[];
  total: number;
  page: number;
  pageSize: number;
};

// FEA-3 (PRD 16): the tenant's support tickets. OWNER and STAFF can read;
// only OWNER can close a ticket (the [id] route).
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
    const [items, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where: { tenantId },
        skip,
        take,
        orderBy: { createdAt: "desc" },
      }),
      prisma.supportTicket.count({ where: { tenantId } }),
    ]);
    return res.status(200).json(apiOk({ items, total, page, pageSize }));
  });
}
