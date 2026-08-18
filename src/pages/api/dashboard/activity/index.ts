import type { NextApiRequest, NextApiResponse } from "next";
import type { Prisma } from "@prisma/client";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { paginate, requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import type { ListResult } from "@/types/dashboard";

// Include the agent relation (id + name) on every audit row so the UI can
// attribute each entry to a named agent or to a human (agentId null).
const auditLogInclude = {
  agent: { select: { id: true, name: true } },
} satisfies Prisma.AuditLogInclude;

// Serialized AuditLog row with the agent relation attached. Prisma serializes
// Json columns as `unknown` and DateTime as an ISO string, matching the shape
// the browser receives — no `as` needed on either side.
type AuditLogItem = Prisma.AuditLogGetPayload<{ include: typeof auditLogInclude }>;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ListResult<AuditLogItem>>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  // OWNER + STAFF may read the audit log; STAFF read is allowed by design.
  if (!requireRole(session, "OWNER", "STAFF")) {
    return respondError(res, "PERMISSION_DENIED", "Akses ditolak.");
  }
  const tenantId = requireTenant(session);

  if (req.method === "GET") {
    const { skip, take, page, pageSize } = paginate(req.query);
    const where: Prisma.AuditLogWhereInput = { tenantId };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: auditLogInclude,
      }),
      prisma.auditLog.count({ where }),
    ]);
    return res.status(200).json(apiOk({ items, total, page, pageSize }));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
