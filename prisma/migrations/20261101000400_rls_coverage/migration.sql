-- D9: complete RLS coverage. The original RLS migration created policies for
-- 19 tables; 10 tenant-scoped tables added later never got one: Deal,
-- DealStageHistory, Pipeline, Stage, Scenario, ScenarioRun, ScenarioRunStep,
-- SourceRow, ConversationRead, InventorySnapshot. If RLS is ever activated
-- (dedicated non-owner role + FORCE + per-request SET LOCAL - see
-- src/lib/tenant-context.ts), those tables would have been left open.
--
-- This block is idempotent and self-maintaining for CURRENT tables: it covers
-- every public table that has a tenantId column and no policy yet. New tenant
-- tables added in the future still need this block re-run (or a new
-- migration) - RLS is inert today, so nothing breaks if it is forgotten, but
-- re-check coverage whenever a new tenant-scoped model lands.
--
-- RLS remains INERT by design: the app connects as the table owner, which
-- bypasses non-FORCED policies. Do not add FORCE without the role change
-- described in tenant-context.ts.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public' AND col.table_name = c.relname
          AND col.column_name = 'tenantId'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = c.relname
      )
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING ("tenantId" = current_setting(''app.current_tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.current_tenant_id'', true))',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
