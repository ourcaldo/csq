import prisma from "@csq/core/lib/db";

// SEC-4 (PRD 16): suspension guard for every scheduled customer-facing path.
// The dashboard login gate handles humans; this guards the worker loops
// (campaign fire/deliver, scenario runs, session-close sends, courtesy
// replies). Inbound ingestion is deliberately NOT guarded - data is never
// lost, the tenant simply stops answering while suspended.
export async function tenantActive(tenantId: string): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { status: true },
  });
  return tenant?.status !== "SUSPENDED";
}
