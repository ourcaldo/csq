import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin } from "@/lib/admin-auth";
import { withSystemContext } from "@csq/core/lib/tenant-context";

// Audit (PRD 13 Phase 4): cross-tenant AuditLog + the AdminActionLog.
// ?auditType=admin switches to the operator action log.

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  return withSystemContext(async () => {
    if (req.method !== "GET") {
      return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));
    }

    const { auditType, tenantId, page, pageSize } = req.query;
    const p = typeof page === "string" ? parseInt(page, 10) : 1;
    const size = typeof pageSize === "string" ? Math.min(parseInt(pageSize, 10), 100) : 50;
    const skip = (p - 1) * size;

    if (auditType === "admin") {
      const [items, total] = await Promise.all([
        prisma.adminActionLog.findMany({
          orderBy: { createdAt: "desc" }, skip, take: size,
          include: { admin: { select: { email: true, name: true } } },
        }),
        prisma.adminActionLog.count(),
      ]);
      return res.status(200).json(apiOk({
        items: items.map((a) => ({
          id: a.id, adminEmail: a.admin.email, adminName: a.admin.name,
          action: a.action, targetType: a.targetType, targetId: a.targetId,
          beforeValue: a.beforeValue, afterValue: a.afterValue,
          createdAt: a.createdAt.toISOString(),
        })),
        total, page: p, pageSize: size,
      }));
    }

    const where = typeof tenantId === "string" ? { tenantId } : {};
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where, orderBy: { createdAt: "desc" }, skip, take: size,
        include: { tenant: { select: { name: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);
    return res.status(200).json(apiOk({
      items: items.map((a) => ({
        id: a.id, tenantName: a.tenant?.name ?? a.tenantId,
        agentId: a.agentId, action: a.action, entityType: a.entityType,
        entityId: a.entityId, approvalStatus: a.approvalStatus,
        customerPhone: a.customerPhone,
        beforeValue: a.beforeValue, afterValue: a.afterValue,
        createdAt: a.createdAt.toISOString(),
      })),
      total, page: p, pageSize: size,
    }));

  });
}
