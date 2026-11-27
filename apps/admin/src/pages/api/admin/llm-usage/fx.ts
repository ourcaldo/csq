import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import prisma from "@csq/core/lib/db";
import { apiOk, apiError, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin, auditAdminAction } from "@/lib/admin-auth";
import { withSystemContext } from "@csq/core/lib/tenant-context";

// Manual USD to IDR rate for one UTC day (PRD 33). Manual edits change only
// future usage rows - already-written rows keep their fxRateIdrPerUsd
// snapshot, so recorded cost never drifts.

const fxSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
    .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00.000Z`).getTime()), "Invalid date"),
  usdIdr: z
    .string()
    .trim()
    .min(1)
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, "Must be a number > 0"),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  return withSystemContext(async () => {
    if (req.method !== "POST") {
      return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed."));
    }

    const parsed = fxSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json(apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid payload."));
    }
    const day = new Date(`${parsed.data.date}T00:00:00.000Z`);

    const existing = await prisma.fxRate.findUnique({ where: { date: day } });
    const fx = await prisma.fxRate.upsert({
      where: { date: day },
      create: { date: day, usdIdr: parsed.data.usdIdr, source: "MANUAL", updatedById: admin.adminId },
      update: { usdIdr: parsed.data.usdIdr, source: "MANUAL", updatedById: admin.adminId },
    });
    await auditAdminAction({
      adminId: admin.adminId,
      email: admin.email ?? "",
      action: "fx_rate.upsert",
      targetType: "FxRate",
      targetId: fx.date.toISOString().slice(0, 10),
      beforeValue: existing
        ? {
            date: existing.date.toISOString().slice(0, 10),
            usdIdr: existing.usdIdr.toString(),
            source: existing.source,
          }
        : undefined,
      afterValue: {
        date: fx.date.toISOString().slice(0, 10),
        usdIdr: fx.usdIdr.toString(),
        source: fx.source,
      },
    });
    return res.status(200).json(apiOk({ date: fx.date.toISOString().slice(0, 10) }));
  });
}
