import prisma from "@csq/core/lib/db";
import { getTenantEntitlements } from "@csq/core/lib/entitlements";

// PRD 14 amendment 2026-11-28: total media bytes per tenant, capped by
// Plan.mediaBytesLimit (NULL = unlimited; Free = 500 MB). Called from the
// dashboard upload routes before storing bytes.
export async function getMediaBytesUsed(tenantId: string): Promise<number> {
  const sum = await prisma.mediaAsset.aggregate({
    where: { tenantId },
    _sum: { byteSize: true },
  });
  return sum._sum.byteSize ?? 0;
}

export async function checkMediaQuota(
  tenantId: string,
  extraBytes: number
): Promise<{ allowed: boolean; used: number; limit: number | null }> {
  const [used, entitlements] = await Promise.all([
    getMediaBytesUsed(tenantId),
    getTenantEntitlements(tenantId),
  ]);
  const limit = entitlements.mediaBytesLimit;
  return {
    allowed: limit === null || used + extraBytes <= limit,
    used,
    limit,
  };
}
