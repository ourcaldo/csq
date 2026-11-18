import type { NextApiRequest, NextApiResponse } from "next";
import type { ConversationStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { paginate, requireTenant, respondError, strQuery, HttpError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { getPnForLid } from "@csq/core/lib/baileys-auth-db";
import { findOrCreateConversation } from "@csq/core/lib/inbox";
import type { Stage } from "@csq/core/types/inbox";

type Item = Prisma.ConversationGetPayload<{
  include: {
    channel: { select: { provider: true } };
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
  lastMessage: { body: string; senderType: string; kind: "TEXT" | "MEDIA" | "OTHER" } | null;
  stage: Stage | null;
  // Count of INBOUND messages newer than this user's last-read watermark
  // (WhatsApp-style unread badge). 0 when the user is caught up. Never counts
  // the user's own or the AI's outbound replies.
  unreadCount: number;
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

// Chat Baru (owner request 2026-11-18).
const newChatSchema = z.object({
  phone: z
    .string()
    .min(8)
    .max(25)
    .regex(/^[+0-9]+$/, "Nomor hanya boleh angka (dan + di depan)."),
  name: z.string().max(120).optional(),
});

type CreateResult = { conversationId: string; created: boolean };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ListResult | CreateResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);
  const userId = session.user.id;

  return withTenantContext(tenantId, async () => {
    if (req.method === "GET") {
      const { skip, take, page, pageSize } = paginate(req.query);
      const statusKey = strQuery(req.query, "status");
      const status = statusKey ? STATUS_BY_KEY[statusKey] : undefined;
      const assignedAgentId = strQuery(req.query, "assignedAgentId");
      const assigneeUserId = strQuery(req.query, "assigneeUserId");
      const search = strQuery(req.query, "search");
      const tagId = strQuery(req.query, "tagId");

      const where: Prisma.ConversationWhereInput = {
        tenantId,
        ...(status ? { status } : {}),
        ...(assignedAgentId ? { assignedAgentId } : {}),
        ...(assigneeUserId ? { assigneeUserId } : {}),
        ...(search ? { customerPhone: { contains: search } } : {}),
        ...(tagId ? { tags: { some: { tagId } } } : {}),
      };

      const [items, total] = await Promise.all([
        prisma.conversation.findMany({
          where,
          skip,
          take,
          include: {
            channel: { select: { provider: true } },
            contact: {
              include: {
                categories: { include: { category: true } },
                tags: { include: { tag: true } },
              },
            },
            assignedAgent: true,
            assignee: true,
            tags: { include: { tag: true } },
            deal: { include: { stage: true } },
            messages: { take: 1, orderBy: { createdAt: "desc" }, select: { body: true, senderType: true, kind: true } },
          },
          orderBy: { lastMessageAt: "desc" },
        }),
        prisma.conversation.count({ where }),
      ]);

      // Unread badges: this user's last-read watermark per conversation, then
      // count INBOUND messages newer than the watermark. Conversations without
      // a watermark row count from 0 (never opened → every inbound is unread).
      const reads = await prisma.conversationRead.findMany({
        where: { tenantId, userId, conversationId: { in: items.map((i) => i.id) } },
        select: { conversationId: true, lastReadAt: true },
      });
      const readByConv = new Map(reads.map((r) => [r.conversationId, r.lastReadAt]));
      const unreadCounts = new Map<string, number>();
      await Promise.all(
        items.map(async (item) => {
          const watermark = readByConv.get(item.id);
          const count = await prisma.message.count({
            where: {
              tenantId,
              conversationId: item.id,
              direction: "INBOUND",
              ...(watermark ? { createdAt: { gt: watermark } } : {}),
            },
          });
          unreadCounts.set(item.id, count);
        })
      );

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
            ? {
                body: lastMsgs[0].body,
                senderType: lastMsgs[0].senderType,
                kind: lastMsgs[0].kind,
              }
            : null;
          const stage = item.deal?.stage ?? null;
          return {
            ...rest,
            stage,
            customerPhoneDisplay,
            lastMessage,
            unreadCount: unreadCounts.get(item.id) ?? 0,
          };
        })
      );

      return res.status(200).json(apiOk({ items: itemsWithDisplay, total, page, pageSize }));
    }

    if (req.method === "POST") {
      // Chat Baru (owner request 2026-11-18): start a chat with a number
      // before the customer writes in. Same find-or-create as inbound, so a
      // known number reopens its existing thread instead of duplicating.
      if (!requireRole(session, "OWNER", "STAFF")) {
        return respondError(
          res,
          "PERMISSION_DENIED",
          "Hanya owner/staff yang dapat memulai percakapan."
        );
      }
      const parsed = newChatSchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(res, "VALIDATION_ERROR", parsed.error.message);
      }
      // Same channel choice as Tambah Lead: the connected channel, else the
      // first channel (the chat must have a channel to be sendable at all).
      const channel =
        (await prisma.channel.findFirst({
          where: { tenantId, status: "CONNECTED" },
          orderBy: { createdAt: "asc" },
        })) ??
        (await prisma.channel.findFirst({
          where: { tenantId },
          orderBy: { createdAt: "asc" },
        }));
      if (!channel) {
        return respondError(
          res,
          "VALIDATION_ERROR",
          "Hubungkan saluran WhatsApp terlebih dahulu."
        );
      }
      try {
        const digits = parsed.data.phone.replace(/[^0-9]/g, "");
        const phone = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
        const { conversation, created } = await findOrCreateConversation(
          tenantId,
          channel.id,
          phone
        );
        if (parsed.data.name?.trim()) {
          await prisma.contact.update({
            where: { tenantId_phone: { tenantId, phone } },
            data: { name: parsed.data.name.trim() },
          });
        }
        return res.status(200).json(
          apiOk({ conversationId: conversation.id, created })
        );
      } catch (err) {
        if (err instanceof HttpError) {
          return respondError(res, err.code, err.message);
        }
        return respondError(
          res,
          "INTERNAL_ERROR",
          "Gagal memulai percakapan."
        );
      }
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
