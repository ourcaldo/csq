import prisma from "@/lib/db";

// tenantId is always taken from the authenticated session — never from request
// bodies or conversation content (prompt-injection defense, PRD §18).
// setTenantContext sets the Postgres session var used by RLS policies as the
// second isolation layer beneath application-level tenantId filtering.

export type TenantSession = { tenantId?: string };

export function resolveTenantId(session: TenantSession): string {
  if (!session.tenantId) {
    throw new Error("Tenant context missing");
  }
  return session.tenantId;
}

export async function setTenantContext(tenantId: string): Promise<void> {
  await prisma.$executeRaw`SET LOCAL app.current_tenant_id = ${tenantId}`;
}
