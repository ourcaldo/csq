-- PRD 16 remediation (2026-11-09). One migration for all schema changes:
-- COR-1 (SENDING claim state), SEC-4 (autoPaused campaigns), SEC-5
-- (AdminUser.role), FEA-1 (knowledge source fields), FEA-5 (invite tokens +
-- mustChangePassword), FEA-2 (Refund), FEA-3 (SupportTicket), FEA-7 (SyncLog),
-- COR-5 (partial unique on open plan requests), and SEC-1 (RLS activation:
-- non-owner app role, bypass policies, grants).
--
-- SEC-1 note: FORCE ROW LEVEL SECURITY is deliberately NOT used. The app
-- switches to the dedicated non-owner role csq_app, which is subject to RLS
-- without FORCE; FORCE would additionally bind the owner role that runs
-- migrations and admin provisioning. See the dated note in PRD 16 SEC-1.

-- ── COR-1: campaign claim state ──
ALTER TYPE "CampaignMessageStatus" ADD VALUE 'SENDING';

-- ── SEC-4: suspension can distinguish its own pauses ──
ALTER TABLE "Campaign" ADD COLUMN "autoPaused" BOOLEAN NOT NULL DEFAULT false;

-- ── SEC-5: admin realm role ──
ALTER TABLE "AdminUser" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'SUPERADMIN';

-- ── FEA-1: knowledge document provenance ──
ALTER TABLE "Knowledge" ADD COLUMN "sourceName" TEXT;
ALTER TABLE "Knowledge" ADD COLUMN "mimeType" TEXT;

-- ── FEA-8: data-authority confidence ──
ALTER TABLE "InventorySnapshot" ADD COLUMN "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1;

-- ── FEA-5: invited staff set their own password ──
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- ── FEA-2: refunds ──
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "createdByAgentId" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Refund_tenantId_status_idx" ON "Refund"("tenantId", "status");
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── FEA-3: support tickets ──
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'RESOLVED');
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT,
    "contactPhone" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "createdByAgentId" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportTicket_tenantId_status_idx" ON "SupportTicket"("tenantId", "status");
CREATE INDEX "SupportTicket_tenantId_createdAt_idx" ON "SupportTicket"("tenantId", "createdAt");
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── FEA-5: one-time team invites ──
CREATE TABLE "TeamInvite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'STAFF',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TeamInvite_tokenHash_key" ON "TeamInvite"("tokenHash");
CREATE INDEX "TeamInvite_tenantId_idx" ON "TeamInvite"("tenantId");
CREATE INDEX "TeamInvite_email_idx" ON "TeamInvite"("email");
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── FEA-7: sync history ──
CREATE TYPE "SyncLogStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "status" "SyncLogStatus" NOT NULL,
    "rowsCreated" INTEGER NOT NULL DEFAULT 0,
    "rowsUpdated" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SyncLog_tenantId_dataSourceId_createdAt_idx" ON "SyncLog"("tenantId", "dataSourceId", "createdAt");
ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── COR-5: at most one open plan request per tenant, race-safe ──
-- API still checks first for a friendly message; this index is the guarantee.
CREATE UNIQUE INDEX "PlanRequest_open_tenantId_key"
    ON "PlanRequest"("tenantId")
    WHERE "status" IN ('NEW', 'CONTACTED');

-- ── SEC-1: RLS activation ──
-- 1. Tenant isolation policies for the new tables (Refund, SupportTicket,
--    TeamInvite, SyncLog). Same self-maintaining shape as the D9 coverage
--    migration: every public table with a tenantId column and no policy yet.
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

-- 2. Bypass policies: system paths (auth lookup, admin console, register,
--    worker cross-tenant loops) set app.bypass_rls = 'on' inside their
--    request transaction. Permissive policies OR together, so this is an
--    explicit escape hatch, never a weakening of the tenant predicate.
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

-- 3. The dedicated app role. Created with an unknown random password if
--    absent; the operator sets the real one when wiring DATABASE_URL (see
--    .env examples). Grants + default privileges keep future migration
--    tables accessible to it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'csq_app') THEN
    EXECUTE format(
      'CREATE ROLE %I LOGIN PASSWORD %L',
      'csq_app', gen_random_uuid()::text || gen_random_uuid()::text
    );
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO csq_app', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO csq_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO csq_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO csq_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO csq_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO csq_app;
