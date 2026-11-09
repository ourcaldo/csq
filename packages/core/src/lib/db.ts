import { PrismaClient, Prisma } from "@prisma/client";
import { tenantAls } from "./tenant-als";

// The only place PrismaClient is instantiated. Every query imports `prisma`
// from here. The global cache prevents connection exhaustion during Next.js
// dev hot-reloads. No `as` casting - `declare global` types the cache slot.
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const base = globalThis.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = base;
}

// RLS activation hook (PRD 16 SEC-1). Tenant tables have row-level security
// policies on tenant_id = app.current_tenant_id; the app connects as the
// non-owner role csq_app, which is subject to those policies. Every tenant-
// scoped operation must therefore run with the context set ON THE SAME
// connection, which the array-form $transaction guarantees (official Prisma
// RLS pattern). Callers establish context via withTenantContext /
// withSystemContext from tenant-context.ts; operations without any context
// fail CLOSED (zero rows) on tenant tables - that is the security property.
const prisma = base.$extends(
  Prisma.defineExtension((client) =>
    client.$extends({
      query: {
        $allModels: {
          async $allOperations({ args, query }) {
            const store = tenantAls.getStore();
            if (!store || store.inTx) return query(args);
            if (store.bypass) {
              const [, result] = await client.$transaction([
                client.$executeRaw`SELECT set_config('app.bypass_rls', 'on', TRUE)`,
                query(args),
              ]);
              return result;
            }
            if (store.tenantId) {
              const [, result] = await client.$transaction([
                client.$executeRaw`SELECT set_config('app.current_tenant_id', ${store.tenantId}, TRUE)`,
                query(args),
              ]);
              return result;
            }
            return query(args);
          },
        },
      },
    })
  )
);

export default prisma;
