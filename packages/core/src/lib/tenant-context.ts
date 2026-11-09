import type { Prisma } from "@prisma/client";
import { basePrisma } from "./db";
import { tenantAls } from "./tenant-als";

// RLS request context (PRD 16 SEC-1). The policies live in
// prisma/migrations (20260818010000, 20261101000400, 20261109120000):
//   tenant tables: tenantId = current_setting('app.current_tenant_id')
//   bypass policy: current_setting('app.bypass_rls') = 'on'
// The app connects as the non-owner role csq_app (subject to RLS), so every
// code path that touches tenant tables MUST hold one of these contexts.
// A missing context fails closed: zero rows on tenant tables.
//
// Usage, in order of preference:
//   1. Request entry points that resolved a tenantId:
//        return withTenantContext(tenantId, async () => { ... });
//   2. System paths that legitimately cross tenants (auth lookup, register,
//      admin console, worker cross-tenant loops, public media by UUID):
//        return withSystemContext(async () => { ... });
//   3. Multi-statement atomic work: withTenantTransaction below.

export async function withTenantContext<T>(
  tenantId: string,
  fn: () => Promise<T>
): Promise<T> {
  return tenantAls.run({ tenantId, bypass: false, inTx: false }, fn);
}

export async function withSystemContext<T>(fn: () => Promise<T>): Promise<T> {
  return tenantAls.run({ tenantId: null, bypass: true, inTx: false }, fn);
}

// Interactive transaction with the tenant context set on its connection.
// Inside fn, use `tx` exclusively: global prisma calls would escape the
// transaction to a contextless pooled connection.
export async function withTenantTransaction<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return tenantAls.run({ tenantId, bypass: false, inTx: true }, () =>
    basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, TRUE)`;
      return fn(tx);
    })
  );
}

// The bypass twin of withTenantTransaction.
export async function withSystemTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return tenantAls.run({ tenantId: null, bypass: true, inTx: true }, () =>
    basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', TRUE)`;
      return fn(tx);
    })
  );
}

// Raw SQL (queryRaw/executeRaw) does NOT pass through the db extension hook,
// so raw statements touching tenant tables must set the context themselves.
// These helpers run the statement in an array transaction with set_config on
// the same connection - the raw twin of the hook.
export function tenantRaw<T>(
  tenantId: string,
  op: Prisma.PrismaPromise<T>
): Promise<T> {
  return basePrisma
    .$transaction([
      basePrisma.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, TRUE)`,
      op,
    ])
    .then((r) => r[1]);
}

export function systemRaw<T>(op: Prisma.PrismaPromise<T>): Promise<T> {
  return basePrisma
    .$transaction([
      basePrisma.$executeRaw`SELECT set_config('app.bypass_rls', 'on', TRUE)`,
      op,
    ])
    .then((r) => r[1]);
}
