import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@csq/core/lib/auth";
import { requireFeatureApi } from "@csq/core/lib/feature-guard";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { canRunCampaigns } from "@csq/core/lib/campaign-access";
import { campaignPreviewSchema } from "@csq/core/types/campaign";

// Audience preview (plan 3.6): the wizard's live recipient count. The count is
// advisory - the engine resolves the audience fresh at every fire, so it can
// change between save and fire.

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ total: number; byCategory: { categoryId: string; name: string; count: number }[] }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");

  if (!(await requireFeatureApi(session, res, "campaigns"))) return;
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
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

    // OPS-1 (PRD 16): per-category breakdown when the audience is CATEGORY.
    let byCategory: { categoryId: string; name: string; count: number }[] = [];
    if (input.audience === "CATEGORY" && input.categoryIds.length > 0) {
      const categories = await prisma.category.findMany({
        where: { tenantId, id: { in: input.categoryIds } },
        select: { id: true, name: true },
      });
      const counts = await prisma.contactCategory.groupBy({
        by: ["categoryId"],
        where: { tenantId, categoryId: { in: input.categoryIds } },
        _count: { contactId: true },
      });
      const countMap = new Map(counts.map((c) => [c.categoryId, c._count.contactId]));
      byCategory = categories.map((c) => ({
        categoryId: c.id,
        name: c.name,
        count: countMap.get(c.id) ?? 0,
      }));
    }
    return res.status(200).json(apiOk({ total, byCategory }));
  });
}
