import type { NextApiRequest, NextApiResponse } from "next";
import type { ConversationStatus, Prisma } from "@prisma/client";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { paginate, requireTenant, respondError, strQuery } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { getPnForLid } from "@/lib/baileys-auth-db";
import type { Stage } from "@/types/inbox";

type Item = Prisma.ConversationGetPayload<{
  include: {
    contact: true;
    assignedAgent: true;
    assignee: true;
    tags: { include: { tag: true } };
    deal: { include: { stage: true } };
  };
}>;
// Item + a display phone number + the current pipeline stage. For LID-based
// chats (newer WhatsApp), customerPhone is the raw LID JID used for sending;
// customerPhoneDisplay is the real phone number resolved from Baileys'
// LID→PN mapping (or the bare LID if unresolved). For classic
// @s.whatsapp.net chats it's the bare phone number.
type DisplayItem = Item & {
  customerPhoneDisplay: string;
  lastMessage: { body: string; senderType: string } | null;
  stage: Stage | null;
};
type ListResult = {
  items: DisplayItem[];
  total: number;
  page: number;
  pageSize: number;
};

// String → enum lookup (avoids `as`-narrowing from a Set.has guard).
const STATUS_BY_KEY: Record<string, ConversationStatus> = {
  OPEN: "OPEN",
  PENDING: "PENDING",
  RESOLVED: "RESOLVED",
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
    const statusKey = strQuery(req.query, "status");
    const status = statusKey ? STATUS_BY_KEY[statusKey] : undefined;
    const assignedAgentId = strQuery(req.query, "assignedAgentId");
    const assigneeUserId = strQuery(req.query, "assigneeUserId");
    const search = strQuery(req.query, "search");

    const where: Prisma.ConversationWhereInput = {
      tenantId,
      ...(status ? { status } : {}),
      ...(assignedAgentId ? { assignedAgentId } : {}),
      ...(assigneeUserId ? { assigneeUserId } : {}),
      ...(search ? { customerPhone: { contains: search } } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        skip,
        take,
        include: {
          contact: true,
          assignedAgent: true,
          assignee: true,
          tags: { include: { tag: true } },
          deal: { include: { stage: true } },
          messages: { take: 1, orderBy: { createdAt: "desc" }, select: { body: true, senderType: true } },
        },
        orderBy: { lastMessageAt: "desc" },
      }),
      prisma.conversation.count({ where }),
    ]);

    // Resolve LID → real phone number for display + attach the last message + stage.
    const itemsWithDisplay: DisplayItem[] = await Promise.all(
      items.map(async (item) => {
        let customerPhoneDisplay = item.customerPhone;
        if (item.customerPhone.includes("@lid")) {
          const pn = await getPnForLid(item.channelId, item.customerPhone);
          customerPhoneDisplay = pn ?? item.customerPhone.split("@")[0];
        } else if (item.customerPhone.includes("@s.whatsapp.net")) {
          customerPhoneDisplay = item.customerPhone.split("@")[0];
        }
        const { messages: lastMsgs, ...rest } = item;
        const lastMessage = lastMsgs[0]
          ? { body: lastMsgs[0].body, senderType: lastMsgs[0].senderType }
          : null;
        const stage = item.deal?.stage ?? null;
        return { ...rest, stage, customerPhoneDisplay, lastMessage };
      })
    );

    return res.status(200).json(apiOk({ items: itemsWithDisplay, total, page, pageSize }));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
