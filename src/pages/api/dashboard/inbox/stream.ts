import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError, strQuery } from "@/lib/queries";

// Server-Sent Events stream of new messages for a conversation (plan 7.7).
// OWNER + STAFF, tenant-scoped. Polls Postgres every few seconds and pushes
// any messages newer than the last-seen timestamp as SSE `data` events. A
// periodic comment heartbeat keeps proxies from dropping the idle connection.
// True push would use Postgres LISTEN/NOTIFY; polling is the MVP choice
// (no Redis/queue per PRD §23A).

const POLL_INTERVAL_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 15000;

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
  let closed = false;

  const poll = setInterval(async () => {
    if (closed) return;
    try {
      const msgs = await prisma.message.findMany({
        where: { conversationId, tenantId, createdAt: { gt: lastSeen } },
        orderBy: { createdAt: "asc" },
        take: 100,
      });
      for (const m of msgs) {
        res.write(`data: ${JSON.stringify(m)}\n\n`);
        lastSeen = m.createdAt;
      }
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
}
