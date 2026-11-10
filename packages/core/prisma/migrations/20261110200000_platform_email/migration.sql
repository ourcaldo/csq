-- Platform email provider (owner request 2026-11-10): the admin console
-- stores a default SMTP on the BillingSetting singleton. A tenant's own
-- emailProvider (Tenant.settings) takes precedence; tenants without one fall
-- back to this. Same secret-at-rest pattern as the per-tenant provider.

ALTER TABLE "BillingSetting" ADD COLUMN "emailProvider" JSONB;
