-- PRD 14: exact AI credit ledger, manual invoices, plan requests, platform
-- billing settings. tenantLimit is dropped: a plan is assigned per tenant, so
-- a workspace limit cannot be enforced without an account layer.

ALTER TABLE "Plan" DROP COLUMN "tenantLimit";

CREATE TYPE "AiCreditSource" AS ENUM ('REPLY', 'SCENARIO_MODULE');
CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'PAID', 'VOID');
CREATE TYPE "PlanRequestStatus" AS ENUM ('NEW', 'CONTACTED', 'DONE', 'REJECTED');

CREATE TABLE "AiCreditUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" "AiCreditSource" NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 1,
    "refId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCreditUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiCreditUsage_tenantId_source_refId_key" ON "AiCreditUsage"("tenantId", "source", "refId");
CREATE INDEX "AiCreditUsage_tenantId_createdAt_idx" ON "AiCreditUsage"("tenantId", "createdAt");

ALTER TABLE "AiCreditUsage" ADD CONSTRAINT "AiCreditUsage_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invoice numbers: gap-tolerant reference sequence (PRD 14).
CREATE SEQUENCE "Invoice_number_seq";

CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT,
    "planName" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "amountIdr" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "method" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");
CREATE UNIQUE INDEX "Invoice_tenantId_periodStart_key" ON "Invoice"("tenantId", "periodStart");
CREATE INDEX "Invoice_tenantId_status_idx" ON "Invoice"("tenantId", "status");
CREATE INDEX "Invoice_status_dueAt_idx" ON "Invoice"("status", "dueAt");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PlanRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestedPlanId" TEXT NOT NULL,
    "note" TEXT,
    "status" "PlanRequestStatus" NOT NULL DEFAULT 'NEW',
    "handledById" TEXT,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlanRequest_tenantId_status_idx" ON "PlanRequest"("tenantId", "status");
CREATE INDEX "PlanRequest_status_createdAt_idx" ON "PlanRequest"("status", "createdAt");

ALTER TABLE "PlanRequest" ADD CONSTRAINT "PlanRequest_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanRequest" ADD CONSTRAINT "PlanRequest_requestedPlanId_fkey"
  FOREIGN KEY ("requestedPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanRequest" ADD CONSTRAINT "PlanRequest_handledById_fkey"
  FOREIGN KEY ("handledById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "BillingSetting" (
    "id" TEXT NOT NULL,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "bankAccountHolder" TEXT,
    "dueDays" INTEGER NOT NULL DEFAULT 7,
    "graceDays" INTEGER NOT NULL DEFAULT 7,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSetting_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BillingSetting" ADD CONSTRAINT "BillingSetting_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "BillingSetting" ("id", "dueDays", "graceDays", "updatedAt")
VALUES ('singleton', 7, 7, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Backfill the current month so assigning a plan does not reset usage. The
-- unique key makes this idempotent. Historical months are not reconstructed:
-- no tenant was billed before this feature.
INSERT INTO "AiCreditUsage" ("id", "tenantId", "source", "credits", "refId", "createdAt")
SELECT gen_random_uuid()::text, m."tenantId", 'REPLY'::"AiCreditSource", 1, m."id", m."createdAt"
FROM "Message" m
WHERE m."direction" = 'OUTBOUND'
  AND m."senderType" = 'AGENT'
  AND m."createdAt" >= date_trunc('month', now())
ON CONFLICT ("tenantId", "source", "refId") DO NOTHING;

INSERT INTO "AiCreditUsage" ("id", "tenantId", "source", "credits", "refId", "createdAt")
SELECT gen_random_uuid()::text, s."tenantId", 'SCENARIO_MODULE'::"AiCreditSource", 1, s."id", s."startedAt"
FROM "ScenarioRunStep" s
WHERE s."nodeType" NOT IN ('trigger', 'end')
  AND s."startedAt" >= date_trunc('month', now())
ON CONFLICT ("tenantId", "source", "refId") DO NOTHING;
