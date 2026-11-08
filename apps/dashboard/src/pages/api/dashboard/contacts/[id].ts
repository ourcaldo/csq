import type { NextApiRequest, NextApiResponse } from "next";
import type { Contact } from "@prisma/client";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { logHuman } from "@/lib/audit";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { contactUpdateSchema } from "@/types/contact";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Contact>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  const { id } = req.query;
  if (typeof id !== "string") {
    return respondError(res, "VALIDATION_ERROR", "ID kontak tidak valid.");
  }

  if (req.method === "GET") {
    const contact = await prisma.contact.findFirst({ where: { id, tenantId } });
    if (!contact) return respondError(res, "NOT_FOUND", "Kontak tidak ditemukan.");
    return res.status(200).json(apiOk(contact));
  }

  if (req.method === "PUT") {
    if (!requireRole(session, "OWNER")) {
      return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengubah kontak.");
    }
    const parsed = contactUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    const existing = await prisma.contact.findFirst({
      where: { id, tenantId },
      include: {
        categories: { include: { category: true } },
        tags: { include: { tag: true } },
      },
    });
    if (!existing) return respondError(res, "NOT_FOUND", "Kontak tidak ditemukan.");

    const { categoryIds, tagIds, ...scalarFields } = parsed.data;

    // Replace-set semantics: the arrays become the new full set. All ids must
    // belong to this tenant - an unknown id is a 400, not a silent skip.
    const [categoryRows, tagRows] = await Promise.all([
      categoryIds
        ? prisma.category.findMany({ where: { tenantId, id: { in: categoryIds } }, select: { id: true } })
        : Promise.resolve([]),
      tagIds
        ? prisma.tag.findMany({ where: { tenantId, id: { in: tagIds } }, select: { id: true } })
        : Promise.resolve([]),
    ]);
    if (categoryIds && categoryRows.length !== categoryIds.length) {
      return respondError(res, "VALIDATION_ERROR", "Ada kategori yang tidak dikenal.");
    }
    if (tagIds && tagRows.length !== tagIds.length) {
      return respondError(res, "VALIDATION_ERROR", "Ada tag yang tidak dikenal.");
    }

    const contact = await prisma.$transaction(async (tx) => {
      const updated = await tx.contact.update({
        where: { id },
        data: {
          ...(scalarFields.name !== undefined ? { name: scalarFields.name } : {}),
          ...(scalarFields.email !== undefined ? { email: scalarFields.email } : {}),
          ...(scalarFields.notes !== undefined ? { notes: scalarFields.notes } : {}),
        },
      });
      if (categoryIds) {
        await tx.contactCategory.deleteMany({ where: { contactId: id, tenantId } });
        if (categoryIds.length > 0) {
          await tx.contactCategory.createMany({
            data: categoryIds.map((cid) => ({ tenantId, contactId: id, categoryId: cid })),
          });
        }
      }
      if (tagIds) {
        await tx.contactTag.deleteMany({ where: { contactId: id, tenantId } });
        if (tagIds.length > 0) {
          await tx.contactTag.createMany({
            data: tagIds.map((tid) => ({ tenantId, contactId: id, tagId: tid })),
          });
        }
      }
      return updated;
    });

    await logHuman({
      tenantId,
      action: "contact.update",
      entityType: "Contact",
      entityId: id,
      beforeValue: existing,
      afterValue: contact,
    });
    return res.status(200).json(apiOk(contact));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
