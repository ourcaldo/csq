import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import prisma from "@csq/core/lib/db";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin, auditAdminAction } from "@/lib/admin-auth";
import { withSystemContext } from "@csq/core/lib/tenant-context";

// Platform billing settings (PRD 14): bank instructions and due/grace days.
// One row, id "singleton". The tenant invoice page reads it; no env vars.

const putSchema = z.object({
  bankName: z.string().max(100).nullable(),
  bankAccountNumber: z.string().max(50).nullable(),
  bankAccountHolder: z.string().max(100).nullable(),
  dueDays: z.number().int().min(1).max(90),
  graceDays: z.number().int().min(0).max(90),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  return withSystemContext(async () => {

    if (req.method === "GET") {
      const settings = await prisma.billingSetting.findUnique({ where: { id: "singleton" } });
      return res.status(200).json(
        apiOk({
          bankName: settings?.bankName ?? null,
          bankAccountNumber: settings?.bankAccountNumber ?? null,
          bankAccountHolder: settings?.bankAccountHolder ?? null,
          dueDays: settings?.dueDays ?? 7,
          graceDays: settings?.graceDays ?? 7,
          updatedAt: settings?.updatedAt.toISOString() ?? null,
        })
      );
    }

    if (req.method === "PUT") {
      const parsed = putSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json(apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload tidak valid."));
      }
      const existing = await prisma.billingSetting.findUnique({ where: { id: "singleton" } });
      const data = {
        bankName: parsed.data.bankName?.trim() || null,
        bankAccountNumber: parsed.data.bankAccountNumber?.trim() || null,
        bankAccountHolder: parsed.data.bankAccountHolder?.trim() || null,
        dueDays: parsed.data.dueDays,
        graceDays: parsed.data.graceDays,
        updatedById: admin.adminId,
      };
      const updated = await prisma.billingSetting.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", ...data },
        update: data,
      });
      await auditAdminAction({
        adminId: admin.adminId,
        action: "billing_settings.update",
        targetType: "BillingSetting",
        targetId: "singleton",
        beforeValue: existing
          ? {
              bankName: existing.bankName,
              bankAccountNumber: existing.bankAccountNumber,
              bankAccountHolder: existing.bankAccountHolder,
              dueDays: existing.dueDays,
              graceDays: existing.graceDays,
            }
          : undefined,
        afterValue: {
          bankName: updated.bankName,
          bankAccountNumber: updated.bankAccountNumber,
          bankAccountHolder: updated.bankAccountHolder,
          dueDays: updated.dueDays,
          graceDays: updated.graceDays,
        },
      });
      return res.status(200).json(apiOk(updated));
    }

    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));

  });
}
