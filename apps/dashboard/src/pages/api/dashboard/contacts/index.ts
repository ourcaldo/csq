import type { NextApiRequest, NextApiResponse } from "next";
import type { Contact, Prisma } from "@prisma/client";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { normalizePhone } from "@csq/core/lib/contacts";
import { logHuman } from "@csq/core/lib/audit";
import { paginate, requireTenant, respondError, strQuery } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { contactCreateSchema } from "@csq/core/types/contact";
import { getPnForLid } from "@csq/core/lib/baileys-auth-db";

// Replace-set semantics shared by create: unknown ids are a 400, not a skip.
async function attachTaxonomies(
  tenantId: string,
  contactId: string,
  data: { categoryIds?: string[]; tagIds?: string[] }
) {
  if (data.categoryIds && data.categoryIds.length > 0) {
    const rows = await prisma.category.findMany({
      where: { tenantId, id: { in: data.categoryIds } },
      select: { id: true },
    });
    if (rows.length !== data.categoryIds.length) {
      throw new Error("Ada kategori yang tidak dikenal.");
    }
    await prisma.contactCategory.createMany({
      data: data.categoryIds.map((cid) => ({ tenantId, contactId, categoryId: cid })),
    });
  }
  if (data.tagIds && data.tagIds.length > 0) {
    const rows = await prisma.tag.findMany({
      where: { tenantId, id: { in: data.tagIds } },
      select: { id: true },
    });
    if (rows.length !== data.tagIds.length) {
      throw new Error("Ada tag yang tidak dikenal.");
    }
    await prisma.contactTag.createMany({
      data: data.tagIds.map((tid) => ({ tenantId, contactId, tagId: tid })),
    });
  }
}

type ContactWithDisplay = Contact & {
  phoneDisplay: string;
  // PRD 27: WhatsApp profile photo (media service URL), null when absent.
  avatarUrl: string | null;
};
type ListResult = {
  items: ContactWithDisplay[];
  total: number;
  page: number;
  pageSize: number;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Contact | ListResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method === "GET") {
      const { skip, take, page, pageSize } = paginate(req.query);
      const search = strQuery(req.query, "search");
      const categoryId = strQuery(req.query, "categoryId");
      const tagId = strQuery(req.query, "tagId");
      const where: Prisma.ContactWhereInput = {
        tenantId,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { phone: { contains: search } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
        // Classification filters (feature plan 2026-11-01, section 2.4): OR
        // within a set, AND across tag+category.
        ...(categoryId ? { categories: { some: { categoryId } } } : {}),
        ...(tagId ? { tags: { some: { tagId } } } : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.contact.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: "desc" },
          include: {
            conversations: { take: 1, select: { channelId: true } },
            categories: { include: { category: true } },
            tags: { include: { tag: true } },
          },
        }),
        prisma.contact.count({ where }),
      ]);

      // Resolve LID → real phone number for display. PRD 27: avatarUrl from
      // the stored MediaAsset via the media service origin.
      const mediaBase = (process.env.API_URL ?? "").replace(/\/$/, "");
      const items: ContactWithDisplay[] = await Promise.all(
        rows.map(async (c) => {
          let phoneDisplay = c.phone;
          if (c.phone.includes("@lid")) {
            const channelId = c.conversations[0]?.channelId;
            if (channelId) {
              const pn = await getPnForLid(channelId, c.phone);
              phoneDisplay = pn ?? c.phone.split("@")[0];
            } else {
              phoneDisplay = c.phone.split("@")[0];
            }
          } else if (c.phone.includes("@s.whatsapp.net") || c.phone.includes("@g.us")) {
            phoneDisplay = c.phone.split("@")[0];
          }
          // Strip the nested conversations from the response (categories/tags stay -
          // the UI renders the classification chips from them).
          const { conversations: _drop, ...rest } = c;
          const avatarUrl =
            mediaBase && c.avatarMediaId
              ? `${mediaBase}/api/media/${c.avatarMediaId}`
              : null;
          return { ...rest, phoneDisplay, avatarUrl };
        })
      );

      return res.status(200).json(apiOk({ items, total, page, pageSize }));
    }

    // Tambah Kontak (owner request 2026-11-18): manual single add. OWNER-only,
    // same write rule as contact.update.
    if (req.method === "POST") {
      if (!requireRole(session, "OWNER")) {
        return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat menambah kontak.");
      }
      const parsed = contactCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(res, "VALIDATION_ERROR", parsed.error.message);
      }
      const phone = normalizePhone(parsed.data.phone);
      const existing = await prisma.contact.findUnique({
        where: { tenantId_phone: { tenantId, phone } },
      });
      if (existing) {
        return respondError(res, "VALIDATION_ERROR", "Nomor sudah terdaftar sebagai kontak.");
      }
      const contact = await prisma.contact.create({
        data: {
          tenantId,
          phone,
          ...(parsed.data.name ? { name: parsed.data.name } : {}),
          ...(parsed.data.email ? { email: parsed.data.email } : {}),
          ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
          source: "Input Manual",
        },
      });
      await attachTaxonomies(tenantId, contact.id, parsed.data);
      await logHuman({
        tenantId,
        action: "contact.create",
        entityType: "Contact",
        entityId: contact.id,
        afterValue: contact,
      });
      return res.status(201).json(apiOk(contact));
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
