-- D10c: Google OAuth tokens move out of Tenant.settings into a dedicated
-- credentials table. Settings is a config blob several routes read-merge-write;
-- keeping secrets there made any future `select settings` a credential leak.

-- CreateTable
CREATE TABLE "TenantCredential" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiryDate" TIMESTAMP(3),
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantCredential_tenantId_provider_key" ON "TenantCredential"("tenantId", "provider");

-- CreateIndex
CREATE INDEX "TenantCredential_tenantId_idx" ON "TenantCredential"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantCredential" ADD CONSTRAINT "TenantCredential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One-time copy of the existing googleSheets tokens. The legacy key stays in
-- Tenant.settings for now and is removed in a LATER release, once the new
-- read path is verified live - so a rollback of the app code still finds the
-- tokens where the old code reads them.
INSERT INTO "TenantCredential"
  ("id", "tenantId", "provider", "accessToken", "refreshToken", "expiryDate", "email", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  t.id,
  'google',
  t.settings->'googleSheets'->>'accessToken',
  t.settings->'googleSheets'->>'refreshToken',
  CASE
    WHEN (t.settings->'googleSheets'->>'expiryDate') ~ '^[0-9]+$'
      THEN to_timestamp(((t.settings->'googleSheets'->>'expiryDate')::bigint) / 1000)
    ELSE NULL
  END,
  t.settings->'googleSheets'->>'email',
  NOW(),
  NOW()
FROM "Tenant" t
WHERE t.settings ? 'googleSheets'
  AND COALESCE(t.settings->'googleSheets'->>'accessToken', '') <> '';
