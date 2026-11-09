import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import { getTenantEntitlements, getTenantUsage, monthStartUtc } from "@csq/core/lib/entitlements";
import { logAction } from "@csq/core/lib/audit";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, apiError, type ApiResponse } from "@csq/core/types/api";

// Tenant billing surface (PRD 14): current plan, usage, invoices, catalog,
// open request, and the bank instructions the operator configured. OWNER only:
// STAFF must never see invoices or amounts.

const requestSchema = z.object({
  planId: z.string().uuid(),
  note: z.string().max(500).optional(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat melihat tagihan.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method === "GET") {
      const monthStart = monthStartUtc();
      // BIL-2 (PRD 16): one fetch for the newest request of any status. The
      // one-open-request guard means an open request is always the newest
      // one, so openRequest is derived from the same row.
      const [entitlements, usage, invoices, plans, latestRequest, settings] = await Promise.all([
        getTenantEntitlements(tenantId),
        getTenantUsage(tenantId, monthStart),
        prisma.invoice.findMany({
          where: { tenantId },
          orderBy: { periodStart: "desc" },
          take: 24,
          select: {
            id: true,
            number: true,
            planName: true,
            periodStart: true,
            periodEnd: true,
            amountIdr: true,
            status: true,
            dueAt: true,
            paidAt: true,
            method: true,
            reference: true,
          },
        }),
        prisma.plan.findMany({
          orderBy: { priceIdr: "asc" },
          select: {
            id: true,
            name: true,
            priceIdr: true,
            aiCreditsPerMonth: true,
            mauLimit: true,
            staffLimit: true,
            channelLimit: true,
            features: true,
          },
        }),
        prisma.planRequest.findFirst({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          include: { requestedPlan: { select: { name: true } } },
        }),
        prisma.billingSetting.findUnique({ where: { id: "singleton" } }),
      ]);
      const openRequest =
        latestRequest && (latestRequest.status === "NEW" || latestRequest.status === "CONTACTED")
          ? latestRequest
          : null;

      return res.status(200).json(
        apiOk({
          entitlements,
          usage,
          monthStart: monthStart.toISOString(),
          invoices: invoices.map((i) => ({
            ...i,
            periodStart: i.periodStart.toISOString(),
            periodEnd: i.periodEnd.toISOString(),
            dueAt: i.dueAt.toISOString(),
            paidAt: i.paidAt?.toISOString() ?? null,
          })),
          plans,
          openRequest: openRequest
            ? {
                id: openRequest.id,
                requestedPlanId: openRequest.requestedPlanId,
                requestedPlanName: openRequest.requestedPlan.name,
                status: openRequest.status,
                note: openRequest.note,
                createdAt: openRequest.createdAt.toISOString(),
              }
            : null,
          latestRequest: latestRequest
            ? {
                id: latestRequest.id,
                requestedPlanId: latestRequest.requestedPlanId,
                requestedPlanName: latestRequest.requestedPlan.name,
                status: latestRequest.status,
                createdAt: latestRequest.createdAt.toISOString(),
              }
            : null,
          bank:
            settings?.bankName && settings.bankAccountNumber && settings.bankAccountHolder
              ? {
                  name: settings.bankName,
                  accountNumber: settings.bankAccountNumber,
                  accountHolder: settings.bankAccountHolder,
                }
              : null,
          dueDays: settings?.dueDays ?? 7,
          graceDays: settings?.graceDays ?? 7,
        })
      );
    }

    if (req.method === "POST") {
      const parsed = requestSchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(res, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload tidak valid.");
      }

      const open = await prisma.planRequest.findFirst({
        where: { tenantId, status: { in: ["NEW", "CONTACTED"] } },
        select: { id: true },
      });
      if (open) {
        return respondError(res, "VALIDATION_ERROR", "Masih ada permintaan paket yang sedang diproses.");
      }

      const plan = await prisma.plan.findUnique({
        where: { id: parsed.data.planId },
        select: { id: true, name: true },
      });
      if (!plan) {
        return respondError(res, "NOT_FOUND", "Paket tidak ditemukan.");
      }

      let request;
      try {
        request = await prisma.planRequest.create({
          data: {
            tenantId,
            requestedPlanId: plan.id,
            note: parsed.data.note?.trim() || null,
          },
        });
      } catch (err) {
        // COR-5 (PRD 16): the partial unique index on open requests makes a
        // concurrent double-submit collide here - the friendly message wins.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          return respondError(res, "VALIDATION_ERROR", "Masih ada permintaan paket yang sedang diproses.");
        }
        throw err;
      }
      await logAction({
        tenantId,
        agentId: null,
        action: "billing.plan_requested",
        entityType: "PlanRequest",
        entityId: request.id,
        approvalStatus: "NONE",
        afterValue: { plan: plan.name, note: request.note },
      });

      return res.status(201).json(apiOk({ id: request.id, status: request.status }));
    }

    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));
  });
}
