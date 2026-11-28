import prisma from "@csq/core/lib/db";
import { tenantRaw } from "@csq/core/lib/tenant-context";
import {
  isPlanFeature,
  type TenantEntitlements,
  type TenantUsage,
} from "@csq/core/types/entitlements";

// PRD 14 amendment 2026-11-28: there is no unlimited legacy tier. A tenant
// with NO plan gets exactly the Free entitlements (1 channel, 0 staff, 250
// credits, 100 MAU, 1 agent, 500 MB media, no premium features, Rp 0). Once a
// plan is assigned, NULL limits mean unlimited and features are opt-in.
export const FREE_ENTITLEMENTS: TenantEntitlements = {
  planName: "Free",
  aiCreditsPerMonth: 250,
  mauLimit: 100,
  staffLimit: 0,
  channelLimit: 1,
  agentLimit: 1,
  mediaBytesLimit: 524288000,
  features: [],
};

export async function getTenantEntitlements(
  tenantId: string
): Promise<TenantEntitlements> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      plan: {
        select: {
          name: true,
          aiCreditsPerMonth: true,
          mauLimit: true,
          staffLimit: true,
          channelLimit: true,
          agentLimit: true,
          mediaBytesLimit: true,
          features: true,
        },
      },
    },
  });

  if (!tenant?.plan) {
    return FREE_ENTITLEMENTS;
  }

  return {
    planName: tenant.plan.name,
    aiCreditsPerMonth: tenant.plan.aiCreditsPerMonth,
    mauLimit: tenant.plan.mauLimit,
    staffLimit: tenant.plan.staffLimit,
    channelLimit: tenant.plan.channelLimit,
    agentLimit: tenant.plan.agentLimit,
    mediaBytesLimit: tenant.plan.mediaBytesLimit,
    features: tenant.plan.features.filter(isPlanFeature),
  };
}

// Usage counters reset on the first day of the month, UTC.
export function monthStartUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function getTenantUsage(
  tenantId: string,
  since: Date
): Promise<TenantUsage> {
  // COR-4 (PRD 16): credits come from the AiCreditUsage ledger (the same
  // source the hard stop uses), not derived message/step counts, so the
  // displayed usage can never disagree with enforcement. Message and
  // scenario-step counts stay as activity metrics.
  const [creditRows, agentReplies, scenarioCredits, staff, channels, mauRows] = await Promise.all([
    prisma.aiCreditUsage.groupBy({
      by: ["source"],
      where: { tenantId, createdAt: { gte: since } },
      _sum: { credits: true },
    }),
    prisma.message.count({
      where: {
        tenantId,
        direction: "OUTBOUND",
        senderType: "AGENT",
        createdAt: { gte: since },
      },
    }),
    prisma.scenarioRunStep.count({
      where: {
        tenantId,
        nodeType: { notIn: ["trigger", "end"] },
        startedAt: { gte: since },
      },
    }),
    prisma.user.count({ where: { tenantId, isOwner: false } }),
    prisma.channel.count({ where: { tenantId, status: "CONNECTED" } }),
    tenantRaw(
      tenantId,
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(DISTINCT c."customerPhone") AS count
        FROM "Message" m
        JOIN "Conversation" c ON c.id = m."conversationId"
        WHERE m."tenantId" = ${tenantId}
          AND m.direction = 'INBOUND'
          AND m."createdAt" >= ${since}
      `
    ),
  ]);

  const replyCredits = creditRows.find((r) => r.source === "REPLY")?._sum.credits ?? 0;
  const moduleCredits =
    creditRows.find((r) => r.source === "SCENARIO_MODULE")?._sum.credits ?? 0;

  return {
    mau: Number(mauRows[0]?.count ?? 0),
    agentReplies,
    scenarioCredits,
    creditsUsed: replyCredits + moduleCredits,
    replyCredits,
    moduleCredits,
    staff,
    channels,
  };
}
