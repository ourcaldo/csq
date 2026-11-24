import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import { visibleChannelIds } from "@csq/core/lib/channel-access";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { inboxNotifyScope } from "@csq/core/lib/push-notify";

// PRD 30: tenant-wide SSE stream of new INBOUND customer messages for the
// browser-notification foreground path. Same Postgres-poll pattern as the
// per-conversation stream.ts (no Redis per PRD 23A). Scope (all / assigned
// / off) and channel visibility are enforced server-side; the client only
// renders what arrives.

const POLL_INTERVAL_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 15000;
const CURSOR_OVERLAP_MS = 2000;
const MAX_TRACKED_IDS = 1000;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method Not Allowed");
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

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { notificationPrefs: true },
    });
    const scope = inboxNotifyScope(user?.notificationPrefs);
    if (scope === "off") {
      // The client does not connect when off; this is the server-side
      // backstop so a stale tab cannot keep streaming events.
      return res.status(204).end();
    }
    const assignedScope =
      scope === "assigned"
        ? { conversation: { assigneeUserId: session.user.id } }
        : {};

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    let lastSeen = new Date();
    const sentIds = new Set<string>();
    let closed = false;

    const poll = setInterval(async () => {
      if (closed) return;
      try {
        const since = new Date(lastSeen.getTime() - CURSOR_OVERLAP_MS);
        const msgs = await prisma.message.findMany({
          where: {
            tenantId,
            direction: "INBOUND",
            senderType: "CUSTOMER",
            kind: { in: ["TEXT", "MEDIA"] },
            createdAt: { gte: since },
            ...channelScope,
            ...assignedScope,
          },
          orderBy: { createdAt: "asc" },
          take: 50,
          select: {
            id: true,
            conversationId: true,
            body: true,
            createdAt: true,
            conversation: {
              select: {
                channelId: true,
                customerPhone: true,
                contact: { select: { name: true } },
              },
            },
          },
        });
        for (const m of msgs) {
          if (sentIds.has(m.id)) continue;
          sentIds.add(m.id);
          if (m.createdAt.getTime() > lastSeen.getTime()) lastSeen = m.createdAt;
          const title =
            m.conversation.contact?.name?.trim() || m.conversation.customerPhone;
          res.write(
            `data: ${JSON.stringify({
              conversationId: m.conversationId,
              channelId: m.conversation.channelId,
              title,
              body: m.body.slice(0, 80),
            })}\n\n`
          );
        }
        if (sentIds.size > MAX_TRACKED_IDS) sentIds.clear();
      } catch {
        // Swallow transient DB errors; next tick retries.
      }
    }, POLL_INTERVAL_MS);

    const heartbeat = setInterval(() => {
      if (closed) return;
      res.write(":heartbeat\n\n");
    }, HEARTBEAT_INTERVAL_MS);

    req.on("close", () => {
      closed = true;
      clearInterval(poll);
      clearInterval(heartbeat);
      res.end();
    });
  });
}
