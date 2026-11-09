import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import prisma from "@csq/core/lib/db";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin, auditAdminAction } from "@/lib/admin-auth";
import { withSystemContext } from "@csq/core/lib/tenant-context";

// Plan requests (PRD 14): the tenant asks for a package, the operator works
// the list here. Assignment stays on /admin/plans after payment.

const patchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["CONTACTED", "DONE", "REJECTED"]),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  return withSystemContext(async () => {

    if (req.method === "GET") {
      const items = await prisma.planRequest.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          tenant: { select: { name: true, slug: true } },
          requestedPlan: { select: { name: true, priceIdr: true } },
        },
      });
      return res.status(200).json(
        apiOk({
          items: items.map((r) => ({
            id: r.id,
            tenantId: r.tenantId,
            tenantName: r.tenant.name,
            tenantSlug: r.tenant.slug,
            requestedPlanId: r.requestedPlanId,
            requestedPlanName: r.requestedPlan.name,
            requestedPlanPrice: r.requestedPlan.priceIdr,
            note: r.note,
            status: r.status,
            createdAt: r.createdAt.toISOString(),
            handledAt: r.handledAt?.toISOString() ?? null,
          })),
        })
      );
    }

    if (req.method === "PATCH") {
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json(apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload tidak valid."));
      }
      const existing = await prisma.planRequest.findUnique({ where: { id: parsed.data.id } });
      if (!existing) {
        return res.status(404).json(apiError("NOT_FOUND", "Permintaan tidak ditemukan."));
      }
      const updated = await prisma.planRequest.update({
        where: { id: existing.id },
        data: {
          status: parsed.data.status,
          handledById: admin.adminId,
          handledAt: new Date(),
        },
      });
      await auditAdminAction({
        adminId: admin.adminId,
        action: "plan_request.status",
        targetType: "PlanRequest",
        targetId: updated.id,
        beforeValue: { status: existing.status },
        afterValue: { status: updated.status },
      });
      return res.status(200).json(apiOk(updated));
    }

    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));

  });
}
