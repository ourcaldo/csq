import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin } from "@/lib/admin-auth";
import { systemRaw, withSystemContext } from "@csq/core/lib/tenant-context";

// Usage metering (PRD 14). Credits come from the AiCreditUsage ledger, MAU
// from unique inbound senders this month, channels from CONNECTED rows only.
// Derived at read time except the ledger, which is the billing truth.

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  return withSystemContext(async () => {
    if (req.method !== "GET") {
      return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));
    }

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [tenants, creditRows, mediaBytes, staffCounts, channelCounts, mauRows] =
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
              },
            },
          },
        }),
        prisma.aiCreditUsage.groupBy({
          by: ["tenantId", "source"],
          where: { createdAt: { gte: monthStart } },
          _sum: { credits: true },
        }),
        prisma.mediaAsset.groupBy({ by: ["tenantId"], _sum: { byteSize: true } }),
        prisma.user.groupBy({
          by: ["tenantId"],
          where: { role: "STAFF" },
          _count: { id: true },
        }),
        prisma.channel.groupBy({
          by: ["tenantId"],
          where: { status: "CONNECTED" },
          _count: { id: true },
        }),
        systemRaw(
          prisma.$queryRaw<{ tenantId: string; count: bigint }[]>`
            SELECT m."tenantId", count(DISTINCT c."customerPhone") AS count
            FROM "Message" m
            JOIN "Conversation" c ON c.id = m."conversationId"
            WHERE m.direction = 'INBOUND'
              AND m."createdAt" >= ${monthStart}
            GROUP BY m."tenantId"
          `
        ),
      ]);

    const mediaMap = new Map(mediaBytes.map((m) => [m.tenantId, m._sum.byteSize ?? 0]));
    const staffMap = new Map(staffCounts.map((s) => [s.tenantId, s._count.id]));
    const channelMap = new Map(channelCounts.map((c) => [c.tenantId, c._count.id]));
    const mauMap = new Map(mauRows.map((r) => [r.tenantId, Number(r.count)]));
    const replyMap = new Map<string, number>();
    const scenarioMap = new Map<string, number>();
    for (const row of creditRows) {
      const credits = row._sum.credits ?? 0;
      if (row.source === "REPLY") replyMap.set(row.tenantId, credits);
      if (row.source === "SCENARIO_MODULE") scenarioMap.set(row.tenantId, credits);
    }

    // Platform-wide messages per day for the last 30 days (the overview chart).
    const DAYS = 30;
    const dailyStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (DAYS - 1))
    );
    const dailyRows = await systemRaw(
      prisma.$queryRaw<{ day: Date; count: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS day, count(*) AS count
        FROM "Message"
        WHERE "createdAt" >= ${dailyStart}
        GROUP BY 1
        ORDER BY 1
      `
    );
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
      const channelCount = channelMap.get(t.id) ?? 0;
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
        mediaBytes: mediaMap.get(t.id) ?? 0,
      };
    });

    return res
      .status(200)
      .json(apiOk({ items, monthStart: monthStart.toISOString(), daily }));

  });
}
