import type { NextApiRequest, NextApiResponse } from "next";
import type { Category } from "@prisma/client";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { categoryCreateSchema } from "@csq/core/types/contact";
import { normalizeHex, randomHex } from "@/lib/tag-color";

// Contact category taxonomy (feature plan 2026-11-01, section 2.4).
// GET: the tenant's full list (taxonomies are small - no pagination).
// POST: OWNER-only; upserts by name so the same category cannot duplicate.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Category[]>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  if (req.method === "GET") {
    const items = await prisma.category.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
    });
    return res.status(200).json(apiOk(items));
  }

  if (req.method === "POST") {
    if (!requireRole(session, "OWNER")) {
      return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat membuat kategori.");
    }
    const parsed = categoryCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    const color = normalizeHex(parsed.data.color) ?? randomHex();
    const category = await prisma.category.upsert({
      where: { tenantId_name: { tenantId, name: parsed.data.name } },
      create: { tenantId, name: parsed.data.name, color },
      update: { color },
    });
    await logHuman({
      tenantId,
      action: "category.upsert",
      entityType: "Category",
      entityId: category.id,
      afterValue: category,
    });
    return res.status(201).json(apiOk([category]));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
