-- PRD 33: LLM usage and cost tracking. LlmUsage is the tenant-scoped cost
-- paper trail (one row per successful LLM call); LlmModelPrice and FxRate are
-- operator-maintained platform tables (no tenantId, no RLS).

CREATE TYPE "LlmUsageSource" AS ENUM ('AGENT_CALL', 'SCENARIO_AI', 'EMBEDDING', 'GUARD');
CREATE TYPE "FxRateSource" AS ENUM ('AUTO', 'MANUAL');

CREATE TABLE "LlmUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" "LlmUsageSource" NOT NULL,
    "refId" TEXT,
    "conversationId" TEXT,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "costUsd" DECIMAL(16,8),
    "fxRateIdrPerUsd" DECIMAL(12,2),
    "costIdr" DECIMAL(16,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmUsage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LlmModelPrice" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputUsdPer1M" DECIMAL(14,6) NOT NULL,
    "outputUsdPer1M" DECIMAL(14,6) NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmModelPrice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FxRate" (
    "date" TIMESTAMP(3) NOT NULL,
    "usdIdr" DECIMAL(12,2) NOT NULL,
    "source" "FxRateSource" NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("date")
);

CREATE UNIQUE INDEX "LlmModelPrice_model_key" ON "LlmModelPrice"("model");
CREATE UNIQUE INDEX "FxRate_date_key" ON "FxRate"("date");
CREATE INDEX "LlmUsage_tenantId_createdAt_idx" ON "LlmUsage"("tenantId", "createdAt");
CREATE INDEX "LlmUsage_createdAt_idx" ON "LlmUsage"("createdAt");
CREATE INDEX "LlmUsage_tenantId_source_refId_idx" ON "LlmUsage"("tenantId", "source", "refId");

ALTER TABLE "LlmUsage" ADD CONSTRAINT "LlmUsage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: the same two policies every tenant table carries - tenant isolation
-- plus the system bypass (pattern of 20260818010000 + 20261123140000).
ALTER TABLE "LlmUsage" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "LlmUsage_tenant_isolation" ON "LlmUsage" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
CREATE POLICY "LlmUsage_bypass_rls" ON "LlmUsage" FOR ALL
  USING (current_setting('app.bypass_rls', true) = 'on');
