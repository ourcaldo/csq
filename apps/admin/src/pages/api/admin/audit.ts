import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import prisma from "@csq/core/lib/db";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin } from "@/lib/admin-auth";
import { withSystemContext } from "@csq/core/lib/tenant-context";

// Audit (PRD 13 Phase 4): cross-tenant AuditLog + the AdminActionLog.
// ?auditType=admin switches to the operator action log.
// ADM-3 (PRD 16): optional filters - action (contains), from/to (UTC calendar
// days, inclusive), plus adminId on the admin log and tenantId on the tenant log.

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDay(value: unknown, endOfDay: boolean): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const start = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;
  return endOfDay ? new Date(start.getTime() + DAY_MS - 1) : start;
}

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

    const { auditType, tenantId, adminId, action, from, to, page, pageSize } = req.query;
    const p = typeof page === "string" ? parseInt(page, 10) : 1;
    const size = typeof pageSize === "string" ? Math.min(parseInt(pageSize, 10), 100) : 50;
    const skip = (p - 1) * size;

    const fromAt = parseDay(from, false);
    const toAt = parseDay(to, true);
    const createdAt: { gte?: Date; lte?: Date } = {};
    if (fromAt) createdAt.gte = fromAt;
    if (toAt) createdAt.lte = toAt;

    if (auditType === "admin") {
      const adminWhere: Prisma.AdminActionLogWhereInput = {};
      if (typeof adminId === "string" && adminId) adminWhere.adminId = adminId;
      if (typeof action === "string" && action) {
        adminWhere.action = { contains: action };
      }
      if (fromAt || toAt) adminWhere.createdAt = createdAt;
      const [items, total] = await Promise.all([
        prisma.adminActionLog.findMany({
          where: adminWhere,
          orderBy: { createdAt: "desc" }, skip, take: size,
          include: { admin: { select: { email: true, name: true } } },
        }),
        prisma.adminActionLog.count({ where: adminWhere }),
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

    const where: Prisma.AuditLogWhereInput = {};
    if (typeof tenantId === "string" && tenantId) where.tenantId = tenantId;
    if (typeof action === "string" && action) {
      where.action = { contains: action };
    }
    if (fromAt || toAt) where.createdAt = createdAt;
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
