import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@csq/core/lib/db";
import { monthStartUtc } from "@csq/core/lib/entitlements";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin, auditAdminAction } from "@/lib/admin-auth";
import { withSystemContext } from "@csq/core/lib/tenant-context";

// Manual invoices (PRD 14). GET also returns the tenants that have a plan but
// no invoice for the current period, the operator's monthly checklist.

const createSchema = z.object({
  tenantId: z.string().uuid(),
  planId: z.string().uuid().nullable(),
  period: z.string().regex(/^\d{4}-\d{2}$/, "Periode harus YYYY-MM."),
  amountIdr: z.number().int().min(0),
  dueAt: z.coerce.date().optional(),
});

const patchSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["paid", "void"]),
  method: z.string().max(50).optional(),
  reference: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  return withSystemContext(async () => {

    if (req.method === "GET") {
      const monthStart = monthStartUtc();
      const [invoices, tenantsWithPlan, invoicedThisMonth] = await Promise.all([
        prisma.invoice.findMany({
          orderBy: { issuedAt: "desc" },
          take: 100,
          include: { tenant: { select: { name: true } } },
        }),
        prisma.tenant.findMany({
          where: { planId: { not: null } },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            plan: { select: { id: true, name: true, priceIdr: true } },
          },
        }),
        prisma.invoice.findMany({
          where: { periodStart: monthStart },
          select: { tenantId: true },
        }),
      ]);
      const invoiced = new Set(invoicedThisMonth.map((i) => i.tenantId));

      return res.status(200).json(
        apiOk({
          items: invoices.map((i) => ({
            id: i.id,
            number: i.number,
            tenantId: i.tenantId,
            tenantName: i.tenant.name,
            planName: i.planName,
            periodStart: i.periodStart.toISOString(),
            periodEnd: i.periodEnd.toISOString(),
            amountIdr: i.amountIdr,
            status: i.status,
            issuedAt: i.issuedAt.toISOString(),
            dueAt: i.dueAt.toISOString(),
            paidAt: i.paidAt?.toISOString() ?? null,
            method: i.method,
            reference: i.reference,
          })),
          needsInvoice: tenantsWithPlan
            .filter((t) => !invoiced.has(t.id) && t.plan)
            .map((t) => ({
              tenantId: t.id,
              tenantName: t.name,
              planId: t.plan?.id ?? null,
              planName: t.plan?.name ?? null,
              priceIdr: t.plan?.priceIdr ?? 0,
            })),
          monthStart: monthStart.toISOString(),
        })
      );
    }

    if (req.method === "POST") {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json(apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload tidak valid."));
      }
      const { tenantId, planId, period, amountIdr } = parsed.data;

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true },
      });
      if (!tenant) {
        return res.status(404).json(apiError("NOT_FOUND", "Tenant tidak ditemukan."));
      }
      const plan = planId
        ? await prisma.plan.findUnique({ where: { id: planId }, select: { name: true } })
        : null;

      const [year, month] = period.split("-").map(Number);
      const periodStart = new Date(Date.UTC(year, month - 1, 1));
      const periodEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
      const settings = await prisma.billingSetting.findUnique({ where: { id: "singleton" } });
      const issuedAt = new Date();
      const dueAt =
        parsed.data.dueAt ??
        new Date(issuedAt.getTime() + (settings?.dueDays ?? 7) * 24 * 60 * 60 * 1000);

      const seqRows = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT nextval('"Invoice_number_seq"') AS n
      `;
      const seq = Number(seqRows[0]?.n ?? 1);
      const number = `INV-${year}${String(month).padStart(2, "0")}-${String(seq).padStart(4, "0")}`;

      try {
        const invoice = await prisma.invoice.create({
          data: {
            tenantId,
            planId,
            planName: plan?.name ?? "Manual",
            number,
            periodStart,
            periodEnd,
            amountIdr,
            issuedAt,
            dueAt,
          },
        });
        await auditAdminAction({
          adminId: admin.adminId,
          action: "invoice.create",
          targetType: "Invoice",
          targetId: invoice.id,
          afterValue: { tenant: tenant.name, number, amountIdr, period },
        });
        return res.status(201).json(apiOk(invoice));
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          return res
            .status(400)
            .json(apiError("VALIDATION_ERROR", "Invoice untuk tenant dan periode ini sudah ada."));
        }
        console.error("[admin/invoices] create failed:", err);
        return res.status(500).json(apiError("INTERNAL_ERROR", "Gagal membuat invoice."));
      }
    }

    if (req.method === "PATCH") {
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json(apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload tidak valid."));
      }
      const existing = await prisma.invoice.findUnique({ where: { id: parsed.data.id } });
      if (!existing) {
        return res.status(404).json(apiError("NOT_FOUND", "Invoice tidak ditemukan."));
      }
      if (existing.status !== "ISSUED") {
        return res
          .status(400)
          .json(apiError("VALIDATION_ERROR", "Invoice ini sudah lunas atau dibatalkan."));
      }

      const updated = await prisma.invoice.update({
        where: { id: existing.id },
        data:
          parsed.data.action === "paid"
            ? {
                status: "PAID",
                paidAt: new Date(),
                method: parsed.data.method ?? "TRANSFER",
                reference: parsed.data.reference ?? null,
              }
            : { status: "VOID", note: parsed.data.note ?? null },
      });
      await auditAdminAction({
        adminId: admin.adminId,
        action: `invoice.${parsed.data.action}`,
        targetType: "Invoice",
        targetId: updated.id,
        beforeValue: { status: existing.status },
        afterValue: { status: updated.status, method: updated.method, reference: updated.reference },
      });
      return res.status(200).json(apiOk(updated));
    }

    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));

  });
}
