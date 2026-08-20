import type { NextApiRequest, NextApiResponse } from "next";
import type { Contact, Prisma } from "@prisma/client";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { paginate, requireTenant, respondError, strQuery } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { getPnForLid } from "@/lib/baileys-auth-db";

type ContactWithDisplay = Contact & { phoneDisplay: string };
type ListResult = {
  items: ContactWithDisplay[];
  total: number;
  page: number;
  pageSize: number;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ListResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  if (req.method === "GET") {
    const { skip, take, page, pageSize } = paginate(req.query);
    const search = strQuery(req.query, "search");
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
    };
    const [rows, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: { conversations: { take: 1, select: { channelId: true } } },
      }),
      prisma.contact.count({ where }),
    ]);

    // Resolve LID → real phone number for display.
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
        // Strip the nested conversations from the response.
        const { conversations: _drop, ...rest } = c;
        return { ...rest, phoneDisplay };
      })
    );

    return res.status(200).json(apiOk({ items, total, page, pageSize }));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
