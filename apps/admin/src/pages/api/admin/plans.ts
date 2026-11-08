import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { PLAN_FEATURE_KEYS } from "@csq/core/types/entitlements";
import { requireAdmin, auditAdminAction } from "@/lib/admin-auth";
import { z } from "zod";

// Plans (PRD 13): the entitlement catalog. No payments; assignment is manual.
// NULL on a limit means unlimited; features are opt-in keys from the shared
// catalog. PATCH = assign a plan to a tenant.

const planInputSchema = z.object({
  name: z.string().min(1).max(100),
  priceIdr: z.number().int().min(0),
  aiCreditsPerMonth: z.number().int().positive().nullable(),
  mauLimit: z.number().int().positive().nullable(),
  staffLimit: z.number().int().positive().nullable(),
  channelLimit: z.number().int().positive().nullable(),
  features: z.array(z.enum(PLAN_FEATURE_KEYS)),
});

const updateSchema = planInputSchema.extend({ id: z.string().uuid() });

const assignSchema = z.object({
  planId: z.string().uuid().nullable(),
  tenantId: z.string().uuid(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === "GET") {
    const plans = await prisma.plan.findMany({
      orderBy: { priceIdr: "asc" },
      include: { _count: { select: { tenants: true } } },
    });
    return res.status(200).json(apiOk({
      items: plans.map((p) => ({
        id: p.id,
        name: p.name,
        priceIdr: p.priceIdr,
        aiCreditsPerMonth: p.aiCreditsPerMonth,
        mauLimit: p.mauLimit,
        staffLimit: p.staffLimit,
        channelLimit: p.channelLimit,
        features: p.features,
        tenantCount: p._count.tenants,
        createdAt: p.createdAt.toISOString(),
      })),
    }));
  }

  if (req.method === "POST") {
    const parsed = planInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload tidak valid."));
    }
    const plan = await prisma.plan.create({ data: parsed.data });
    await auditAdminAction({
      adminId: admin.adminId, action: "plan.create",
      targetType: "Plan", targetId: plan.id, afterValue: parsed.data,
    });
    return res.status(201).json(apiOk(plan));
  }

  if (req.method === "PUT") {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload tidak valid."));
    }
    const { id, ...data } = parsed.data;
    const existing = await prisma.plan.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(apiError("NOT_FOUND", "Paket tidak ditemukan."));
    }
    const updated = await prisma.plan.update({ where: { id }, data });
    await auditAdminAction({
      adminId: admin.adminId, action: "plan.update",
      targetType: "Plan", targetId: id,
      beforeValue: existing, afterValue: updated,
    });
    return res.status(200).json(apiOk(updated));
  }

  if (req.method === "DELETE") {
    const { id } = req.query;
    if (typeof id !== "string") {
      return res.status(400).json(apiError("VALIDATION_ERROR", "ID paket tidak valid."));
    }
    const plan = await prisma.plan.findUnique({
      where: { id }, include: { _count: { select: { tenants: true } } },
    });
    if (!plan) {
      return res.status(404).json(apiError("NOT_FOUND", "Paket tidak ditemukan."));
    }
    if (plan._count.tenants > 0) {
      return res.status(400).json(apiError("VALIDATION_ERROR", "Paket masih dipakai tenant - reassign dulu."));
    }
    await prisma.plan.delete({ where: { id } });
    await auditAdminAction({
      adminId: admin.adminId, action: "plan.delete",
      targetType: "Plan", targetId: id, beforeValue: { name: plan.name },
    });
    return res.status(200).json(apiOk({ id, deleted: true }));
  }

  if (req.method === "PATCH") {
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload tidak valid."));
    }
    const tenant = await prisma.tenant.findUnique({
      where: { id: parsed.data.tenantId },
      select: { id: true, name: true, planId: true },
    });
    if (!tenant) {
      return res.status(404).json(apiError("NOT_FOUND", "Tenant tidak ditemukan."));
    }
    if (parsed.data.planId) {
      const plan = await prisma.plan.findUnique({ where: { id: parsed.data.planId } });
      if (!plan) {
        return res.status(404).json(apiError("NOT_FOUND", "Paket tidak ditemukan."));
      }
    }
    const updated = await prisma.tenant.update({
      where: { id: parsed.data.tenantId },
      data: { planId: parsed.data.planId },
      select: { id: true, name: true, planId: true },
    });
    await auditAdminAction({
      adminId: admin.adminId, action: "plan.assign",
      targetType: "Tenant", targetId: parsed.data.tenantId,
      beforeValue: { planId: tenant.planId },
      afterValue: { planId: updated.planId },
    });
    return res.status(200).json(apiOk(updated));
  }

  return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));
}
