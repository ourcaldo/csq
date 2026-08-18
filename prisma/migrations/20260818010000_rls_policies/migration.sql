-- Row Level Security: the second tenant-isolation layer beneath the
-- application-level tenantId filtering in every query (requireTenant).
--
-- Each tenant-owned table gets a policy that compares tenant_id against
-- the Postgres session variable `app.current_tenant_id`, set by
-- src/lib/tenant-context.ts setTenantContext() (SET LOCAL ...).
--
-- Note on enforcement: RLS is ENABLEd but NOT FORCED, so the table OWNER
-- (the role the Next.js app connects as in the MVP docker stack) bypasses
-- these policies — app-level filtering remains the live guard. The policies
-- enforce for any non-owner role, so switching the app to a dedicated
-- limited role (recommended post-MVP) activates this layer without code
-- changes. FORCE RLS is intentionally NOT used because Prisma runs queries
-- on pooled connections and `SET LOCAL` does not persist across them; forcing
-- RLS here would therefore drop all rows for the app role. Making the tenant
-- context stick requires interactive transactions ($transaction) per request,
-- a larger refactor deferred past the MVP.

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
      'CREATE POLICY %I ON %I FOR ALL USING (tenant_id = current_setting(''app.current_tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
