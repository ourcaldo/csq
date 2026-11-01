import type { NextApiRequest, NextApiResponse } from "next";
import type { Category } from "@prisma/client";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { logHuman } from "@/lib/audit";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { categoryUpdateSchema } from "@/types/contact";
import { normalizeHex } from "@/lib/tag-color";

// Category rename/recolor + delete. DELETE removes the join rows only
// (Cascade on ContactCategory) — contacts are never deleted.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Category>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  const { id } = req.query;
  if (typeof id !== "string") {
    return respondError(res, "VALIDATION_ERROR", "ID kategori tidak valid.");
  }

  if (req.method === "PUT") {
    if (!requireRole(session, "OWNER")) {
      return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengubah kategori.");
    }
    const parsed = categoryUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    const existing = await prisma.category.findFirst({ where: { id, tenantId } });
    if (!existing) return respondError(res, "NOT_FOUND", "Kategori tidak ditemukan.");

    const color =
      parsed.data.color === undefined
        ? undefined
        : parsed.data.color === null
          ? null
          : normalizeHex(parsed.data.color) ?? undefined;
    const category = await prisma.category.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(color !== undefined ? { color } : {}),
      },
    });
    await logHuman({
      tenantId,
      action: "category.update",
      entityType: "Category",
      entityId: id,
      beforeValue: existing,
      afterValue: category,
    });
    return res.status(200).json(apiOk(category));
  }

  if (req.method === "DELETE") {
    if (!requireRole(session, "OWNER")) {
      return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat menghapus kategori.");
    }
    const existing = await prisma.category.findFirst({ where: { id, tenantId } });
    if (!existing) return respondError(res, "NOT_FOUND", "Kategori tidak ditemukan.");
    // Join rows cascade: contacts are detached, never deleted.
    await prisma.category.delete({ where: { id } });
    await logHuman({
      tenantId,
      action: "category.delete",
      entityType: "Category",
      entityId: id,
      beforeValue: existing,
    });
    return res.status(200).json(apiOk(existing));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
