import type { NextApiRequest, NextApiResponse } from "next";
import type { Tag } from "@prisma/client";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { logHuman } from "@/lib/audit";
import { paginate, requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { tagCreateSchema } from "@/types/tag";
import { normalizeHex, randomHex } from "@/lib/tag-color";

type ListResult = { items: Tag[]; total: number; page: number; pageSize: number };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Tag | ListResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  if (req.method === "GET") {
    const { skip, take, page, pageSize } = paginate(req.query);
    const [items, total] = await Promise.all([
      prisma.tag.findMany({ where: { tenantId }, skip, take, orderBy: { name: "asc" } }),
      prisma.tag.count({ where: { tenantId } }),
    ]);
    return res.status(200).json(apiOk({ items, total, page, pageSize }));
  }

  if (req.method === "POST") {
    // Tag creation is OWNER-only (PRD §8 — owner controls taxonomy).
    if (!requireRole(session, "OWNER")) {
      return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat membuat tag.");
    }
    const parsed = tagCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    // Color is optional: normalize a valid hex, or auto-assign a random one so
    // every tag always renders with a distinct color.
    const color = normalizeHex(parsed.data.color) ?? randomHex();
    const tag = await prisma.tag.create({
      data: { name: parsed.data.name, color, tenantId },
    });
    await logHuman({
      tenantId,
      action: "tag.create",
      entityType: "Tag",
      entityId: tag.id,
      afterValue: tag,
    });
    return res.status(201).json(apiOk(tag));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
