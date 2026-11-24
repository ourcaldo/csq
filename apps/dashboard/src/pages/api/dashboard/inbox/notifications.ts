import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import { visibleChannelIds } from "@csq/core/lib/channel-access";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

// PRD 30 amendment (owner 2026-11-24): the topbar bell is an INTERNAL
// notification center - the user's unread-conversation feed (Facebook-bell
// style), derived live from the same watermark the inbox unread badges use.
// No new table, no fan-out: unread = an INBOUND message newer than this
// user's ConversationRead watermark (none = every inbound is unread).
// Independent of the browser-notification scope: the list always shows
// every unread conversation on the user's visible channels.

const CANDIDATE_BATCH = 30;
const LIST_LIMIT = 8;

export type InboxNotificationItem = {
  conversationId: string;
  title: string;
  snippet: string;
  channelLabel: string;
  at: string;
};

type Result = { items: InboxNotificationItem[]; total: number };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Result>>
) {
  if (req.method !== "GET") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requirePermission(session, "inbox.lihat")) {
    return respondError(res, "PERMISSION_DENIED", "Akses inbox ditolak.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const visible = await visibleChannelIds(session);
    const channelScope = visible ? { channelId: { in: visible } } : {};

    const candidates = await prisma.conversation.findMany({
      where: { tenantId, ...channelScope, messages: { some: { direction: "INBOUND" } } },
      orderBy: { lastMessageAt: "desc" },
      take: CANDIDATE_BATCH,
      select: {
        id: true,
        customerPhone: true,
        contact: { select: { name: true } },
        channel: { select: { label: true } },
        reads: { where: { userId: session.user.id }, select: { lastReadAt: true } },
        messages: {
          where: { direction: "INBOUND" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { body: true, createdAt: true },
        },
      },
    });

    const items: InboxNotificationItem[] = [];
    for (const c of candidates) {
      const lastInbound = c.messages[0];
      if (!lastInbound) continue;
      const watermark = c.reads[0]?.lastReadAt;
      if (watermark && lastInbound.createdAt <= watermark) continue;
      items.push({
        conversationId: c.id,
        title: c.contact?.name?.trim() || c.customerPhone.split("@")[0],
        snippet: lastInbound.body.slice(0, 90),
        channelLabel: c.channel.label,
        at: lastInbound.createdAt.toISOString(),
      });
    }

    return res.status(200).json(apiOk({ items: items.slice(0, LIST_LIMIT), total: items.length }));
  });
}
