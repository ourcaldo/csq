-- PRD 15 amendment (owner 2026-11-24): the Meta webhook verify token moves
-- from per-channel Channel.config to a per-tenant column on Tenant. One
-- Meta app per tenant (tenant-own-WABA), one verify token per app, minted at
-- tenant provisioning so it exists before any channel does.
ALTER TABLE "Tenant" ADD COLUMN "webhookVerifyToken" TEXT;

UPDATE "Tenant"
SET "webhookVerifyToken" = 'csq-' || replace(gen_random_uuid()::text, '-', '')
WHERE "webhookVerifyToken" IS NULL;

ALTER TABLE "Tenant" ALTER COLUMN "webhookVerifyToken" SET NOT NULL;
CREATE UNIQUE INDEX "Tenant_webhookVerifyToken_key" ON "Tenant"("webhookVerifyToken");

-- Strip the legacy per-channel copies: the tenant column is the single
-- source of truth now (webhook reads it, the UI renders it).
UPDATE "Channel" SET config = config - 'verifyToken' WHERE config ? 'verifyToken';
