import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin } from "@/lib/admin-auth";

// Usage metering (PRD 13 Phase 5): per-tenant monthly usage vs plan
// limits, derived from existing Message rows at read time.

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
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      plan: { select: { name: true, limits: true } },
      _count: { select: { channels: true } },
    },
  });

  const monthMessages = await prisma.message.groupBy({
    by: ["tenantId", "direction", "senderType"],
    where: { createdAt: { gte: monthStart } },
    _count: { id: true },
  });

  const mediaBytes = await prisma.mediaAsset.groupBy({
    by: ["tenantId"],
    _sum: { byteSize: true },
  });
  const mediaMap = new Map(mediaBytes.map((m) => [m.tenantId, m._sum.byteSize ?? 0]));

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

  const usageMap = new Map<string, { outbound: number; agentReplies: number; inbound: number }>();
  for (const row of monthMessages) {
    const existing = usageMap.get(row.tenantId) ?? { outbound: 0, agentReplies: 0, inbound: 0 };
    if (row.direction === "OUTBOUND") {
      existing.outbound += row._count.id;
      if (row.senderType === "AGENT") existing.agentReplies += row._count.id;
    } else if (row.direction === "INBOUND") {
      existing.inbound += row._count.id;
    }
    usageMap.set(row.tenantId, existing);
  }

  const items = tenants.map((t) => {
    const usage = usageMap.get(t.id) ?? { outbound: 0, agentReplies: 0, inbound: 0 };
    const limits = (t.plan?.limits ?? {}) as Record<string, number | null | undefined>;
    const agentLimit = limits.agentRepliesPerMonth ?? null;
    const outLimit = limits.messagesOutPerMonth ?? null;
    return {
      tenantId: t.id, tenantName: t.name,
      planName: t.plan?.name ?? null, planId: t.planId,
      agentReplies: usage.agentReplies,
      agentRepliesLimit: agentLimit,
      agentRepliesOver: agentLimit !== null && usage.agentReplies > agentLimit,
      outbound: usage.outbound,
      outboundLimit: outLimit,
      outboundOver: outLimit !== null && usage.outbound > outLimit,
      inbound: usage.inbound,
      channelCount: t._count.channels,
      channelLimit: limits.channels ?? null,
      mediaBytes: mediaMap.get(t.id) ?? 0,
    };
  });

  return res.status(200).json(apiOk({ items, monthStart: monthStart.toISOString(), daily }));
}
