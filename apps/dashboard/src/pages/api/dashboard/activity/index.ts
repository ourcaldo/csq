import type { NextApiRequest, NextApiResponse } from "next";
import type { Prisma } from "@prisma/client";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { paginate, requireTenant, respondError, strQuery } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import type { ListResult } from "@csq/core/types/dashboard";

// Include the agent relation (id + name) on every audit row so the UI can
// attribute each entry to a named agent or to a human (agentId null).
const auditLogInclude = {
  agent: { select: { id: true, name: true } },
} satisfies Prisma.AuditLogInclude;

// Serialized AuditLog row with the agent relation attached. Prisma serializes
// Json columns as `unknown` and DateTime as an ISO string, matching the shape
// the browser receives - no `as` needed on either side.
type AuditLogItem = Prisma.AuditLogGetPayload<{ include: typeof auditLogInclude }>;

// FEA-7 (PRD 16): date inputs are yyyy-mm-dd (parsed as UTC by Date), so
// "from" is the start of that day and "to" is inclusive (end of day).
// Invalid values fall back to "no bound" instead of 500-ing the request.
function startOfDay(v: string): Date | undefined {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function endOfDay(v: string): Date | undefined {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

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

  return withTenantContext(tenantId, async () => {
    if (req.method === "GET") {
      const { skip, take, page, pageSize } = paginate(req.query);
      // FEA-7 (PRD 16): optional filters - agent, action substring, date range.
      const agentId = strQuery(req.query, "agentId");
      const action = strQuery(req.query, "action");
      const gte = startOfDay(strQuery(req.query, "from") ?? "");
      const lte = endOfDay(strQuery(req.query, "to") ?? "");
      const where: Prisma.AuditLogWhereInput = {
        tenantId,
        ...(agentId ? { agentId } : {}),
        ...(action
          ? { action: { contains: action, mode: "insensitive" } }
          : {}),
        ...(gte || lte
          ? { createdAt: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } }
          : {}),
      };
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
  });
}
