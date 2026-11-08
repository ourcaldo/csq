-- Enterprise plan Phase 7 (PRD 23C): tenant API keys for the /api/v1 token
-- realm. Plaintext tokens are never stored - only the sha256 hash plus a
-- display prefix. RLS policy follows the D9 coverage rule.

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_tokenHash_key" ON "ApiKey"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");

-- CreateIndex
CREATE INDEX "ApiKey_tenantId_idx" ON "ApiKey"("tenantId");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- D9: RLS coverage for the new tenant table (inert until activation).
ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ApiKey_tenant_isolation" ON "ApiKey" FOR ALL USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
