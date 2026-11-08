import type { AiCreditSource } from "@prisma/client";
import prisma from "@csq/core/lib/db";
import { getTenantEntitlements, monthStartUtc } from "@csq/core/lib/entitlements";

// AI credit ledger (PRD 14). One row per charged unit, unique per
// (tenant, source, ref) so retries and double drains cannot double charge.

export type CreditStatus = {
  used: number;
  limit: number | null;
  exhausted: boolean;
};

export async function getCreditStatus(
  tenantId: string,
  since: Date = monthStartUtc()
): Promise<CreditStatus> {
  const [entitlements, sum] = await Promise.all([
    getTenantEntitlements(tenantId),
    prisma.aiCreditUsage.aggregate({
      where: { tenantId, createdAt: { gte: since } },
      _sum: { credits: true },
    }),
  ]);
  const used = sum._sum.credits ?? 0;
  const limit = entitlements.aiCreditsPerMonth;
  return { used, limit, exhausted: limit !== null && used >= limit };
}

export async function chargeCredits(input: {
  tenantId: string;
  source: AiCreditSource;
  refId: string;
  note?: string;
}): Promise<void> {
  await prisma.aiCreditUsage.createMany({
    data: [
      {
        tenantId: input.tenantId,
        source: input.source,
        refId: input.refId,
        note: input.note,
      },
    ],
    skipDuplicates: true,
  });
}
