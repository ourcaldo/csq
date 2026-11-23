-- Audit run-4 finding 1: migration 20261123120000 covered the two new
-- tenant tables with the tenant-isolation policy only. Every other tenant
-- table also carries a permissive `_bypass_rls` policy (pattern from
-- 20261109120000_prd16_remediation) so system paths (auth lookup, admin,
-- worker loops) that set app.bypass_rls can read them. Without it, Role and
-- ChannelAccess rows are invisible under withSystemContext: the sign-in
-- role lookup and the per-request permission load both return no role, so
-- every non-owner user gets zero permissions (fail closed) and channel
-- grants are unreadable even for granted staff.
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
          AND p.policyname = t || '_bypass_rls'
      )
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (current_setting(''app.bypass_rls'', true) = ''on'')',
      t || '_bypass_rls', t
    );
  END LOOP;
END $$;
