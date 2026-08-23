import type { NextApiRequest, NextApiResponse } from "next";
import type { Tag } from "@prisma/client";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { logHuman } from "@/lib/audit";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { tagUpdateSchema } from "@/types/tag";
import { normalizeHex, randomHex } from "@/lib/tag-color";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Tag | { id: string }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  const { id } = req.query;
  if (typeof id !== "string") {
    return respondError(res, "VALIDATION_ERROR", "ID tag tidak valid.");
  }

  // Rename + delete are OWNER-only (PRD §8 — owner controls taxonomy).
  if (req.method === "PUT") {
    if (!requireRole(session, "OWNER")) {
      return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengubah tag.");
    }
    const parsed = tagUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    const existing = await prisma.tag.findFirst({ where: { id, tenantId } });
    if (!existing) return respondError(res, "NOT_FOUND", "Tag tidak ditemukan.");
    // Build the update payload explicitly so an absent `color` means "leave
    // as-is", while an empty/invalid `color` means "give me a fresh random
    // one" — matching the create behavior.
    const data: { name?: string; color?: string } = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.color !== undefined) {
      data.color = normalizeHex(parsed.data.color) ?? randomHex();
    }
    const tag = await prisma.tag.update({ where: { id }, data });
    await logHuman({
      tenantId,
      action: "tag.update",
      entityType: "Tag",
      entityId: id,
      beforeValue: existing,
      afterValue: tag,
    });
    return res.status(200).json(apiOk(tag));
  }

  if (req.method === "DELETE") {
    if (!requireRole(session, "OWNER")) {
      return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat menghapus tag.");
    }
    const existing = await prisma.tag.findFirst({ where: { id, tenantId } });
    if (!existing) return respondError(res, "NOT_FOUND", "Tag tidak ditemukan.");
    // Cascades ConversationTag associations.
    await prisma.tag.delete({ where: { id } });
    await logHuman({
      tenantId,
      action: "tag.delete",
      entityType: "Tag",
      entityId: id,
      beforeValue: existing,
    });
    return res.status(200).json(apiOk({ id }));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
