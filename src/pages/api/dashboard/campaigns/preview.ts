import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { canRunCampaigns } from "@/lib/campaign-access";
import { campaignPreviewSchema } from "@/types/campaign";

// Audience preview (plan 3.6): the wizard's live recipient count. The count is
// advisory — the engine resolves the audience fresh at every fire, so it can
// change between save and fire.

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ total: number }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);
  if (!canRunCampaigns(session)) {
    return respondError(res, "PERMISSION_DENIED", "Tidak punya izin kampanye.");
  }

  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const parsed = campaignPreviewSchema.safeParse(req.body);
  if (!parsed.success) {
    return respondError(res, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Input tidak valid.");
  }
  const input = parsed.data;

  const where =
    input.audience === "ALL"
      ? { tenantId }
      : input.audience === "CATEGORY"
        ? { tenantId, categories: { some: { categoryId: { in: input.categoryIds } } } }
        : input.audience === "TAGS"
          ? { tenantId, tags: { some: { tagId: { in: input.tagIds } } } }
          : { tenantId, id: { in: input.contactIds } };

  const total = await prisma.contact.count({ where });
  return res.status(200).json(apiOk({ total }));
}
