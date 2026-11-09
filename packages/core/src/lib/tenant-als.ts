import { AsyncLocalStorage } from "async_hooks";

// Per-request tenant context for RLS (PRD 16 SEC-1). The AsyncLocalStorage
// store propagates through every await inside a request, so core libraries
// called from a wrapped route inherit the context without threading it
// through every function signature.
export type TenantStore = {
  tenantId: string | null;
  // System paths (auth lookup, admin console, register, worker cross-tenant
  // loops, public media) set app.bypass_rls instead of a tenant.
  bypass: boolean;
  // True inside withTenantTransaction/withSystemTransaction: an interactive
  // transaction already holds the context on its connection, so the db hook
  // must not wrap operations again (nested transactions throw). Inside those
  // helpers use the `tx` handle exclusively - global prisma calls would
  // escape to a contextless pooled connection.
  inTx: boolean;
};

export const tenantAls = new AsyncLocalStorage<TenantStore>();
