-- Row Level Security policies: DEFINED as a future tenant-isolation layer,
-- but NOT currently enforced at runtime. The active isolation is
-- application-level tenantId filtering on every query (requireTenant +
-- tenant-scoped `where` clauses in src/lib/tenant-context.ts and the API
-- routes). RLS is not a live "second layer" today.
--
-- Each tenant-owned table gets a policy that compares tenant_id against the
-- Postgres session variable `app.current_tenant_id`. The hook that sets it —
-- setTenantContext() in src/lib/tenant-context.ts — exists but is NOT wired
-- into any request/query path, so the session variable is never set at
-- runtime. Even if it were called, `SET LOCAL` does not persist across Prisma
-- pooled connections; it must run inside a per-request `$transaction` with
-- the queries it guards.
--
-- Enforcement status: RLS is ENABLEd but NOT FORCED, and the Next.js app
-- connects as the table OWNER. Non-FORCED RLS policies are bypassed by the
-- owner role, so these policies have no effect on the app's queries
-- regardless of the session variable. App-level filtering remains the only
-- live guard.
--
-- Why FORCE is intentionally NOT added here: forcing RLS while the app still
-- connects as the owner AND setTenantContext is unwired would make every
-- policy evaluate `tenant_id = current_setting('app.current_tenant_id', true)`
-- = `tenant_id = NULL` → zero rows returned → the app breaks completely.
--
-- Activation path (requires DB provisioning — not a code-only change):
--   1. Provision a dedicated limited DB role (NOT the table owner) and point
--      the Prisma connection string at it.
--   2. Add a NEW migration that runs `ALTER TABLE ... FORCE ROW LEVEL
--      SECURITY` for each tenant-owned table. Do NOT do this while the app
--      still connects as owner.
--   3. Wrap each tenant-scoped read/write in a per-request `$transaction`
--      and call setTenantContext(tenantId) as the first statement inside it,
--      so the session variable is set on the same connection that runs the
--      queries.
-- Until all three steps land, these policies remain defined-but-inert.

-- Helper: enable RLS + a tenant-isolation policy on a table. Policies use
-- current_setting(..., true) which returns NULL when unset, so an unset
-- context yields no rows (fail-closed) for non-owner roles.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'User', 'Agent', 'Channel', 'Product', 'Inventory', 'Order',
    'OrderItem', 'Knowledge', 'KnowledgeEmbedding', 'Memory',
    'DataSource', 'AgentCapability', 'AuditLog', 'Approval',
    'Conversation', 'Contact', 'Message', 'Tag', 'ConversationTag'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING ("tenantId" = current_setting(''app.current_tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.current_tenant_id'', true))',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
