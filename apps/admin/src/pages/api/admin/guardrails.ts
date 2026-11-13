import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import prisma from "@csq/core/lib/db";
import { apiOk, apiError, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin } from "@/lib/admin-auth";
import { withSystemContext } from "@csq/core/lib/tenant-context";

// Guardrail monitor (PRD 03 amendment 2026-11-13): the decision-model guard
// writes guard.pre_block / guard.post_flag rows into the tenant AuditLog.
// Cross-tenant read for the admin console, newest first. Filters: type
// (pre|post), tenantId, from/to (UTC calendar days, inclusive).

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDay(value: unknown, endOfDay: boolean): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const start = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;
  return endOfDay ? new Date(start.getTime() + DAY_MS - 1) : start;
}

type GuardData = {
  items: Array<{
    id: string;
    action: string;
    tenantName: string;
    customerPhone: string | null;
    entityId: string;
    afterValue: unknown;
    createdAt: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  return withSystemContext(async () => {
    if (req.method !== "GET") {
      return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed."));
    }

    const { type, tenantId, from, to, page, pageSize } = req.query;
    const p = typeof page === "string" ? parseInt(page, 10) : 1;
    const size = typeof pageSize === "string" ? Math.min(parseInt(pageSize, 10), 100) : 50;

    const fromAt = parseDay(from, false);
    const toAt = parseDay(to, true);
    const createdAt: { gte?: Date; lte?: Date } = {};
    if (fromAt) createdAt.gte = fromAt;
    if (toAt) createdAt.lte = toAt;

    const where: Prisma.AuditLogWhereInput = {
      action:
        type === "pre"
          ? "guard.pre_block"
          : type === "post"
            ? "guard.post_flag"
            : { startsWith: "guard." },
      ...(typeof tenantId === "string" && tenantId ? { tenantId } : {}),
      ...(fromAt || toAt ? { createdAt } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (p - 1) * size,
        take: size,
        include: { tenant: { select: { name: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return res.status(200).json(
      apiOk({
        items: items.map((a) => ({
          id: a.id,
          action: a.action,
          tenantName: a.tenant?.name ?? a.tenantId,
          customerPhone: a.customerPhone,
          entityId: a.entityId,
          afterValue: a.afterValue,
          createdAt: a.createdAt.toISOString(),
        })),
        total,
        page: p,
        pageSize: size,
      })
    );
  });
}
