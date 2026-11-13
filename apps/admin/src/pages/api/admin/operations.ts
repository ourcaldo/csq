import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin, auditAdminAction } from "@/lib/admin-auth";
import { z } from "zod";
import { withSystemContext, systemRaw } from "@csq/core/lib/tenant-context";

// Operations (PRD 13 Phase 3; refocused 2026-11-13, owner request): system
// health first - live reachability and latency of every service and the
// database, plus the AI reply-time SLA computed from Message timestamps.
// The operational queues stay: outbox stats, FAILED messages with retry,
// system locks (incl. the worker heartbeat). The ChannelCommand list and
// Sheets-sync freshness were removed from this page per the same request.
// POST = retry a FAILED outbound message (FAILED -> QUEUED).

const retrySchema = z.object({ messageId: z.string().uuid() });

// Reachability targets. Defaults are this stack's services; a deployment can
// override with SYSTEM_HEALTH_TARGETS ("Name=url,Name=url").
const DEFAULT_HEALTH_TARGETS: Array<{ name: string; url: string }> = [
  { name: "Dashboard", url: "https://csq-dashboard.onrender.com/api/health" },
  { name: "API", url: "https://csq-api.onrender.com/api/health" },
  { name: "Worker", url: "https://csq-worker.onrender.com/" },
];

function healthTargets(): Array<{ name: string; url: string }> {
  const raw = process.env.SYSTEM_HEALTH_TARGETS;
  if (!raw) return DEFAULT_HEALTH_TARGETS;
  return raw
    .split(",")
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq <= 0) return null;
      const name = part.slice(0, eq).trim();
      const url = part.slice(eq + 1).trim();
      return name && url ? { name, url } : null;
    })
    .filter((t): t is { name: string; url: string } => t !== null);
}

async function ping(target: { name: string; url: string }): Promise<{
  name: string;
  ok: boolean;
  ms: number;
  status: number | null;
}> {
  const started = Date.now();
  try {
    const res = await fetch(target.url, { signal: AbortSignal.timeout(5000) });
    return { name: target.name, ok: res.status < 500, ms: Date.now() - started, status: res.status };
  } catch {
    return { name: target.name, ok: false, ms: Date.now() - started, status: null };
  }
}

const replyStatsSchema = z.object({
  n: z.number(),
  avg_s: z.number().nullable(),
  p95_s: z.number().nullable(),
});

// AI reply-time SLA: seconds from the customer's last inbound message to the
// agent reply that follows it, over the newest 500 replies in the window.
// shortcut: sampled from Message timestamps, fine while the table is small;
// move to precomputed metrics if it grows large.
async function agentReplyStats(hours: number): Promise<{
  count: number;
  avgSeconds: number | null;
  p95Seconds: number | null;
}> {
  // Cutoff computed in JS: Prisma binds a JS number parameter as bigint, and
  // make_interval(hours => bigint) does not exist (the 42883 the first
  // version shipped with). A Date binds as timestamp - no interval math.
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  // systemRaw: raw SQL bypasses the db extension's RLS hook, so a bare
  // $queryRaw fails closed on Message (zero rows, silently) - the statement
  // must set app.bypass_rls on its own connection (same pattern as usage.ts).
  // EXTRACT/avg/percentile return numeric, which Prisma maps to Decimal;
  // ::float8 makes them plain JS numbers for the Zod boundary.
  const rows = await systemRaw(prisma.$queryRaw`
    WITH recent AS (
      SELECT "conversationId", "createdAt"
      FROM "Message"
      WHERE "createdAt" >= ${since}
        AND "direction" = 'OUTBOUND'
        AND "senderType" = 'AGENT'
        AND "isInternal" = false
      ORDER BY "createdAt" DESC
      LIMIT 500
    ),
    replies AS (
      SELECT r."createdAt" - i."createdAt" AS dur
      FROM recent r
      JOIN LATERAL (
        SELECT "createdAt" FROM "Message"
        WHERE "conversationId" = r."conversationId"
          AND "direction" = 'INBOUND'
          AND "isInternal" = false
          AND "createdAt" < r."createdAt"
        ORDER BY "createdAt" DESC
        LIMIT 1
      ) i ON true
    )
    SELECT count(*)::int AS n,
           avg(EXTRACT(EPOCH FROM dur))::float8 AS avg_s,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM dur))::float8 AS p95_s
    FROM replies
  `
  );
  const parsed = z.array(replyStatsSchema).safeParse(rows);
  if (!parsed.success || parsed.data.length === 0) {
    return { count: 0, avgSeconds: null, p95Seconds: null };
  }
  const row = parsed.data[0];
  return {
    count: row.n,
    avgSeconds: row.avg_s,
    p95Seconds: row.p95_s,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  return withSystemContext(async () => {
    if (req.method === "GET") {
      const dbStarted = Date.now();
      let dbOk = true;
      try {
        await prisma.$queryRaw`SELECT 1`;
      } catch {
        dbOk = false;
      }
      const [locks, outboxStats, failedMessages, services, hours24, days7] =
        await Promise.all([
          prisma.systemLock.findMany({ orderBy: { key: "asc" } }),
          prisma.outboundMessage.groupBy({ by: ["status"], _count: { id: true } }),
          prisma.outboundMessage.findMany({
            where: { status: "FAILED" },
            orderBy: { updatedAt: "desc" },
            take: 20,
            select: { id: true, tenantId: true, toJid: true, error: true, updatedAt: true },
          }),
          Promise.all(healthTargets().map((t) => ping(t))),
          agentReplyStats(24),
          agentReplyStats(24 * 7),
        ]);

      return res.status(200).json(
        apiOk({
          health: {
            services,
            db: { ok: dbOk, ms: Date.now() - dbStarted },
          },
          aiResponse: { hours24, days7 },
          locks: locks.map((l) => ({
            key: l.key,
            lockedUntil: l.lockedUntil.toISOString(),
            isHeld: l.lockedUntil > new Date(),
            updatedAt: l.updatedAt.toISOString(),
          })),
          outbox: outboxStats.map((s) => ({ status: s.status, count: s._count.id })),
          failedMessages: failedMessages.map((m) => ({
            ...m,
            updatedAt: m.updatedAt.toISOString(),
          })),
        })
      );
    }

    if (req.method === "POST") {
      const parsed = retrySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json(apiError("VALIDATION_ERROR", "messageId diperlukan."));
      }
      const result = await prisma.outboundMessage.updateMany({
        where: { id: parsed.data.messageId, status: "FAILED" },
        data: { status: "QUEUED", error: null },
      });
      if (result.count === 0) {
        return res.status(404).json(apiError("NOT_FOUND", "Pesan tidak ditemukan atau bukan FAILED."));
      }
      await auditAdminAction({
        adminId: admin.adminId, action: "outbox.retry",
        targetType: "OutboundMessage", targetId: parsed.data.messageId,
      });
      return res.status(200).json(apiOk({ retried: true }));
    }

    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));
  });
}
