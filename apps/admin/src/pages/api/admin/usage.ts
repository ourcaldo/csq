import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin } from "@/lib/admin-auth";

// Usage metering (PRD 13). Per-tenant, derived from existing rows at read
// time: MAU = unique inbound senders this month; AI credits = agent replies
// (1 each) + executed scenario modules excluding trigger and end (1 each).
// Plus the plan's seat and channel limits. No ledger table to keep in sync.

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== "GET") {
    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));
  }

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [tenants, monthMessages, mediaBytes, scenarioSteps, staffCounts, mauRows] =
    await Promise.all([
      prisma.tenant.findMany({
        orderBy: { createdAt: "asc" },
        include: {
          plan: {
            select: {
              name: true,
              aiCreditsPerMonth: true,
              mauLimit: true,
              staffLimit: true,
              channelLimit: true,
              tenantLimit: true,
            },
          },
          _count: { select: { channels: true } },
        },
      }),
      prisma.message.groupBy({
        by: ["tenantId", "direction", "senderType"],
        where: { createdAt: { gte: monthStart } },
        _count: { id: true },
      }),
      prisma.mediaAsset.groupBy({ by: ["tenantId"], _sum: { byteSize: true } }),
      prisma.scenarioRunStep.groupBy({
        by: ["tenantId"],
        where: {
          startedAt: { gte: monthStart },
          nodeType: { notIn: ["trigger", "end"] },
        },
        _count: { id: true },
      }),
      prisma.user.groupBy({
        by: ["tenantId"],
        where: { role: "STAFF" },
        _count: { id: true },
      }),
      prisma.$queryRaw<{ tenantId: string; count: bigint }[]>`
        SELECT m."tenantId", count(DISTINCT c."customerPhone") AS count
        FROM "Message" m
        JOIN "Conversation" c ON c.id = m."conversationId"
        WHERE m.direction = 'INBOUND'
          AND m."createdAt" >= ${monthStart}
        GROUP BY m."tenantId"
      `,
    ]);

  const mediaMap = new Map(mediaBytes.map((m) => [m.tenantId, m._sum.byteSize ?? 0]));
  const scenarioMap = new Map(scenarioSteps.map((s) => [s.tenantId, s._count.id]));
  const staffMap = new Map(staffCounts.map((s) => [s.tenantId, s._count.id]));
  const mauMap = new Map(mauRows.map((r) => [r.tenantId, Number(r.count)]));
  const replyMap = new Map<string, number>();
  for (const row of monthMessages) {
    if (row.direction === "OUTBOUND" && row.senderType === "AGENT") {
      replyMap.set(row.tenantId, (replyMap.get(row.tenantId) ?? 0) + row._count.id);
    }
  }

  // Platform-wide messages per day for the last 30 days (the overview chart).
  const DAYS = 30;
  const dailyStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (DAYS - 1))
  );
  const dailyRows = await prisma.$queryRaw<{ day: Date; count: bigint }[]>`
    SELECT date_trunc('day', "createdAt") AS day, count(*) AS count
    FROM "Message"
    WHERE "createdAt" >= ${dailyStart}
    GROUP BY 1
    ORDER BY 1
  `;
  const dailyMap = new Map(
    dailyRows.map((r) => [r.day.toISOString().slice(0, 10), Number(r.count)])
  );
  const daily = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(dailyStart);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    return { date: key, count: dailyMap.get(key) ?? 0 };
  });

  const items = tenants.map((t) => {
    const agentReplies = replyMap.get(t.id) ?? 0;
    const scenarioCredits = scenarioMap.get(t.id) ?? 0;
    const creditsUsed = agentReplies + scenarioCredits;
    const creditsLimit = t.plan?.aiCreditsPerMonth ?? null;
    const mau = mauMap.get(t.id) ?? 0;
    const mauLimit = t.plan?.mauLimit ?? null;
    const staff = staffMap.get(t.id) ?? 0;
    const staffLimit = t.plan?.staffLimit ?? null;
    const channelCount = t._count.channels;
    const channelLimit = t.plan?.channelLimit ?? null;

    return {
      tenantId: t.id,
      tenantName: t.name,
      planName: t.plan?.name ?? null,
      planId: t.planId,
      mau,
      mauLimit,
      mauOver: mauLimit !== null && mau > mauLimit,
      agentReplies,
      scenarioCredits,
      creditsUsed,
      creditsLimit,
      creditsOver: creditsLimit !== null && creditsUsed > creditsLimit,
      staff,
      staffLimit,
      staffOver: staffLimit !== null && staff > staffLimit,
      channelCount,
      channelLimit,
      channelOver: channelLimit !== null && channelCount > channelLimit,
      tenantLimit: t.plan?.tenantLimit ?? null,
      mediaBytes: mediaMap.get(t.id) ?? 0,
    };
  });

  return res
    .status(200)
    .json(apiOk({ items, monthStart: monthStart.toISOString(), daily }));
}
