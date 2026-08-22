import prisma from "@/lib/db";

// tenantId is always taken from the authenticated session — never from request
// bodies or conversation content (prompt-injection defense, PRD §18).
//
// ── Current state of tenant isolation (read this before assuming RLS works) ──
//
// The ACTIVE tenant isolation layer is application-level: every dashboard API
// route resolves tenantId from the session via resolveTenantId()/requireTenant
// and passes it into tenant-scoped `where` clauses on every Prisma query. That
// is the only live guard today.
//
// Row Level Security policies are DEFINED in
// prisma/migrations/20260818010000_rls_policies/migration.sql as a FUTURE
// enforcement layer, but they are NOT currently enforced at runtime:
//   1. The migration uses `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` but does
//      NOT `FORCE ROW LEVEL SECURITY`. The Prisma app connects as the table
//      OWNER, and table owners bypass non-FORCED RLS policies entirely.
//   2. setTenantContext() below (which sets `app.current_tenant_id` via
//      `SET LOCAL`) is the intended hook for activating RLS, but it is NOT
//      wired into any request/query path in the codebase. `SET LOCAL` does
//      not persist across pooled connections, so for it to be effective it
//      must be called inside a per-request `$transaction` together with the
//      queries it guards — not as a standalone call.
//
// Activation path (out of scope for a code-only edit — requires DB provisioning):
//   a. Provision a dedicated limited DB role (NOT the table owner) and point
//      the Prisma connection string at it.
//   b. Add a new migration that runs `ALTER TABLE ... FORCE ROW LEVEL SECURITY`
//      for each tenant-owned table (do NOT do this while the app still
//      connects as owner — it would make every policy evaluate
//      `tenant_id = NULL` and return zero rows, breaking the app).
//   c. Wrap each tenant-scoped read/write in a per-request `$transaction` and
//      call setTenantContext(tenantId) as the first statement inside it, so
//      the session variable is set on the same connection that runs the queries.
//
// Until all three steps land, treat RLS as defined-but-inert and rely on the
// application-level filtering above. Do NOT describe RLS as a "second active
// layer" — it is not.

export type TenantSession = { tenantId?: string };

export function resolveTenantId(session: TenantSession): string {
  if (!session.tenantId) {
    throw new Error("Tenant context missing");
  }
  return session.tenantId;
}

// Not-yet-wired hook for the future RLS enforcement layer (see header above).
// Calling this standalone has no effect on pooled Prisma queries — it must run
// inside a per-request `$transaction` alongside the queries it guards, and
// only after the app is moved off the table-owner role + FORCE RLS is enabled.
export async function setTenantContext(tenantId: string): Promise<void> {
  await prisma.$executeRaw`SET LOCAL app.current_tenant_id = ${tenantId}`;
}
