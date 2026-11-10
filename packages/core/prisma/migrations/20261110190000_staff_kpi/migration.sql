-- PRD 17 (staff KPI, 2026-11-10): KPI targets and closed-period snapshots.
-- Hand-applied over the Neon MCP tool + bookkeeping row with the checksum
-- from scripts/migration-checksums.mjs (same workflow as every migration in
-- this repo; no local DATABASE_URL).

-- Create enums first, then tables, indexes, FKs (Prisma migrate order).
CREATE TYPE "KpiScope" AS ENUM ('TENANT', 'USER');
CREATE TYPE "KpiMetric" AS ENUM ('ORDERS', 'DEALS_WON', 'FIRST_RESPONSE', 'REPLIES');
CREATE TYPE "KpiPeriod" AS ENUM ('DAY', 'WEEK', 'TWO_WEEK', 'MONTH');

-- KPI target: OWNER-configured performance target (tenant or staff scope).
CREATE TABLE "KpiTarget" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scope" "KpiScope" NOT NULL,
    "userId" TEXT,
    "metric" "KpiMetric" NOT NULL,
    "period" "KpiPeriod" NOT NULL,
    "thresholdMinutes" INTEGER,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiTarget_pkey" PRIMARY KEY ("id")
);

-- Closed-period snapshot: one row per target per period, written by the
-- worker at period close.
CREATE TABLE "KpiSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kpiTargetId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "actualValue" DOUBLE PRECISION NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "achieved" BOOLEAN NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KpiSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KpiTarget_tenantId_active_idx" ON "KpiTarget"("tenantId", "active");
CREATE UNIQUE INDEX "KpiSnapshot_kpiTargetId_periodKey_key" ON "KpiSnapshot"("kpiTargetId", "periodKey");
CREATE INDEX "KpiSnapshot_tenantId_kpiTargetId_periodKey_idx" ON "KpiSnapshot"("tenantId", "kpiTargetId", "periodKey");

ALTER TABLE "KpiTarget" ADD CONSTRAINT "KpiTarget_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KpiTarget" ADD CONSTRAINT "KpiTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KpiSnapshot" ADD CONSTRAINT "KpiSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KpiSnapshot" ADD CONSTRAINT "KpiSnapshot_kpiTargetId_fkey" FOREIGN KEY ("kpiTargetId") REFERENCES "KpiTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SEC-1 (PRD 16) pattern, verbatim: tenant-isolation + bypass policies for
-- every tenantId table without one yet (idempotent - covers these two and
-- self-heals anything else). csq_app grants come from the DEFAULT
-- PRIVILEGES set by 20261109120000_prd16_remediation.
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
