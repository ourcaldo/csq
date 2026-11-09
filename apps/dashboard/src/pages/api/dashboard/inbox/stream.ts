import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError, strQuery } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";

// Server-Sent Events stream of new messages for a conversation (plan 7.7).
// OWNER + STAFF, tenant-scoped. Polls Postgres every few seconds and pushes
// any messages newer than the last-seen timestamp as SSE `data` events. A
// periodic comment heartbeat keeps proxies from dropping the idle connection.
// True push would use Postgres LISTEN/NOTIFY; polling is the MVP choice
// (no Redis/queue per PRD §23A).

const POLL_INTERVAL_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 15000;

// D7: a strict `>` cursor silently drops a second message sent in the same
// second - inbound rows carry the WhatsApp timestamp, which is SECOND
// precision. Query with a small overlap window and de-duplicate by id: a
// repeated event is harmless (the client refetches its full history on every
// event) while a missed one is not.
const CURSOR_OVERLAP_MS = 2000;
// Safety valve so the set can never grow unboundedly on a very long-lived
// stream; clearing at worst re-emits a few rows once, which the client's
// idempotent refetch absorbs.
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
  if (!requireRole(session, "OWNER", "STAFF")) {
    return respondError(res, "PERMISSION_DENIED", "Akses inbox ditolak.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const conversationId = strQuery(req.query, "conversationId");
    if (!conversationId) {
      return respondError(res, "VALIDATION_ERROR", "conversationId diperlukan.");
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });
    if (!conversation) {
      return respondError(res, "NOT_FOUND", "Percakapan tidak ditemukan.");
    }

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
          where: { conversationId, tenantId, createdAt: { gte: since } },
          orderBy: { createdAt: "asc" },
          take: 100,
        });
        for (const m of msgs) {
          if (sentIds.has(m.id)) continue;
          sentIds.add(m.id);
          if (m.createdAt.getTime() > lastSeen.getTime()) lastSeen = m.createdAt;
          res.write(`data: ${JSON.stringify(m)}\n\n`);
        }
        if (sentIds.size > MAX_TRACKED_IDS) sentIds.clear();
      } catch {
        // Swallow transient DB errors; next tick retries.
      }
    }, POLL_INTERVAL_MS);

    const heartbeat = setInterval(() => {
      if (closed) return;
      res.write(`:heartbeat\n\n`);
    }, HEARTBEAT_INTERVAL_MS);

    req.on("close", () => {
      closed = true;
      clearInterval(poll);
      clearInterval(heartbeat);
      res.end();
    });
  });
}
