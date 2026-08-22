import type { NextApiRequest, NextApiResponse } from "next";
import type { Product } from "@prisma/client";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { logHuman } from "@/lib/audit";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { productUpdateSchema } from "@/types/product";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Product | { id: string }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  const { id } = req.query;
  if (typeof id !== "string") {
    return respondError(res, "VALIDATION_ERROR", "ID produk tidak valid.");
  }

  if (req.method === "GET") {
    const product = await prisma.product.findFirst({ where: { id, tenantId } });
    if (!product) return respondError(res, "NOT_FOUND", "Produk tidak ditemukan.");
    return res.status(200).json(apiOk(product));
  }

  if (req.method === "PUT") {
    if (!requireRole(session, "OWNER")) {
      return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengubah produk.");
    }
    const parsed = productUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    // Hard delete is NOT used here; update only. Verify ownership first.
    const existing = await prisma.product.findFirst({ where: { id, tenantId } });
    if (!existing) return respondError(res, "NOT_FOUND", "Produk tidak ditemukan.");
    const product = await prisma.product.update({ where: { id }, data: parsed.data });
    await logHuman({
      tenantId,
      action: "product.update",
      entityType: "Product",
      entityId: id,
      beforeValue: existing,
      afterValue: product,
    });
    return res.status(200).json(apiOk(product));
  }

  if (req.method === "DELETE") {
    if (!requireRole(session, "OWNER")) {
      return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat menghapus produk.");
    }
    // Hard delete for MVP (PRD §15 note — YAGNI soft delete). Cascades inventory.
    const existing = await prisma.product.findFirst({ where: { id, tenantId } });
    if (!existing) return respondError(res, "NOT_FOUND", "Produk tidak ditemukan.");
    await prisma.product.delete({ where: { id } });
    await logHuman({
      tenantId,
      action: "product.delete",
      entityType: "Product",
      entityId: id,
      beforeValue: existing,
    });
    return res.status(200).json(apiOk({ id }));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
