-- PRD 30: inbox browser notifications.
-- 1. Per-user dashboard preferences (v1: inboxNotify scope).
ALTER TABLE "User" ADD COLUMN "notificationPrefs" JSONB;

-- 2. Web Push subscriptions (one row per browser/device per user).
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_tenantId_idx" ON "PushSubscription"("tenantId");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

ALTER TABLE "PushSubscription"
  ADD CONSTRAINT "PushSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushSubscription"
  ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. RLS coverage for the new tenant-scoped table (same idempotent block
--    as 20261123120000; the _bypass_rls variant comes from the generic
--    20261123140000 loop on redeploy).
ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "PushSubscription_tenant_isolation" ON "PushSubscription" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));

-- System paths (worker/api push send) run under withSystemContext
-- (app.bypass_rls) like every other tenant table - same policy the generic
-- 20261123140000 loop adds.
CREATE POLICY "PushSubscription_bypass_rls" ON "PushSubscription" FOR ALL
  USING (current_setting('app.bypass_rls', true) = 'on')
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on');
