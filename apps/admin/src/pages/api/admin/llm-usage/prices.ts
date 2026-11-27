import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import prisma from "@csq/core/lib/db";
import { apiOk, apiError, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin, auditAdminAction } from "@/lib/admin-auth";
import { withSystemContext } from "@csq/core/lib/tenant-context";

// Operator price book for LLM models (PRD 33): USD per 1M tokens, entered by
// the operator against current provider pricing - never seeded in code.
// Edits change only future usage rows; snapshots are never rewritten.

const priceSchema = z.object({
  model: z.string().trim().min(1).max(200),
  inputUsdPer1M: z
    .string()
    .trim()
    .min(1)
    .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, "Must be a number >= 0"),
  outputUsdPer1M: z
    .string()
    .trim()
    .min(1)
    .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, "Must be a number >= 0"),
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

    const parsed = priceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json(apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid payload."));
    }
    const { model, inputUsdPer1M, outputUsdPer1M } = parsed.data;

    const existing = await prisma.llmModelPrice.findUnique({ where: { model } });
    const price = await prisma.llmModelPrice.upsert({
      where: { model },
      create: { model, inputUsdPer1M, outputUsdPer1M, updatedById: admin.adminId },
      update: { inputUsdPer1M, outputUsdPer1M, updatedById: admin.adminId },
    });
    await auditAdminAction({
      adminId: admin.adminId,
      email: admin.email ?? "",
      action: "llm_price.upsert",
      targetType: "LlmModelPrice",
      targetId: price.id,
      beforeValue: existing
        ? {
            model: existing.model,
            inputUsdPer1M: existing.inputUsdPer1M.toString(),
            outputUsdPer1M: existing.outputUsdPer1M.toString(),
          }
        : undefined,
      afterValue: {
        model: price.model,
        inputUsdPer1M: price.inputUsdPer1M.toString(),
        outputUsdPer1M: price.outputUsdPer1M.toString(),
      },
    });
    return res.status(200).json(apiOk({ model: price.model }));
  });
}
