import prisma from "@csq/core/lib/db";
import {
  PLAN_FEATURE_KEYS,
  isPlanFeature,
  type PlanFeature,
  type TenantEntitlements,
  type TenantUsage,
} from "@csq/core/types/entitlements";

// A tenant with no plan is a legacy tenant: unlimited and every feature, so
// existing tenants keep working until a plan is assigned. Once a plan is
// assigned, NULL limits mean unlimited and features are opt-in.
const ALL_FEATURES: PlanFeature[] = [...PLAN_FEATURE_KEYS];

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
          tenantLimit: true,
          features: true,
        },
      },
    },
  });

  if (!tenant?.plan) {
    return {
      planName: null,
      aiCreditsPerMonth: null,
      mauLimit: null,
      staffLimit: null,
      channelLimit: null,
      tenantLimit: null,
      features: ALL_FEATURES,
    };
  }

  return {
    planName: tenant.plan.name,
    aiCreditsPerMonth: tenant.plan.aiCreditsPerMonth,
    mauLimit: tenant.plan.mauLimit,
    staffLimit: tenant.plan.staffLimit,
    channelLimit: tenant.plan.channelLimit,
    tenantLimit: tenant.plan.tenantLimit,
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
  const [agentReplies, scenarioCredits, staff, channels, mauRows] = await Promise.all([
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
    prisma.user.count({ where: { tenantId, role: "STAFF" } }),
    prisma.channel.count({ where: { tenantId } }),
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(DISTINCT c."customerPhone") AS count
      FROM "Message" m
      JOIN "Conversation" c ON c.id = m."conversationId"
      WHERE m."tenantId" = ${tenantId}
        AND m.direction = 'INBOUND'
        AND m."createdAt" >= ${since}
    `,
  ]);

  return {
    mau: Number(mauRows[0]?.count ?? 0),
    agentReplies,
    scenarioCredits,
    creditsUsed: agentReplies + scenarioCredits,
    staff,
    channels,
  };
}
