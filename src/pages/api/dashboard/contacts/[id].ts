import type { NextApiRequest, NextApiResponse } from "next";
import type { Contact } from "@prisma/client";
import { getAuthSession } from "@/lib/auth";
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
    const parsed = contactUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    const existing = await prisma.contact.findFirst({ where: { id, tenantId } });
    if (!existing) return respondError(res, "NOT_FOUND", "Kontak tidak ditemukan.");
    const contact = await prisma.contact.update({ where: { id }, data: parsed.data });
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
