-- Scenarios: visual drag-and-drop automation flows (surveys, after-sales).
-- Fire-and-forget outbound sequences; channel-agnostic; on Cloud API no send
-- past the 24h customer-service window. See src/lib/scenario-engine.ts.

-- AlterEnum: add SCENARIO sender so scenario-sent messages are distinguishable
-- in the inbox (tagged "Skenario" vs human/AI).
ALTER TYPE "MessageSenderType" ADD VALUE 'SCENARIO';

-- CreateEnum
CREATE TYPE "ScenarioStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "ScenarioRunStatus" AS ENUM ('RUNNING', 'WAITING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ScenarioTriggerType" AS ENUM ('ON_NEW_CONVERSATION', 'ON_PURCHASE', 'ON_TAG_ADDED');

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ScenarioStatus" NOT NULL DEFAULT 'DRAFT',
    "triggerType" "ScenarioTriggerType" NOT NULL,
    "triggerConfig" JSONB NOT NULL DEFAULT '{}',
    "graph" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" "ScenarioRunStatus" NOT NULL DEFAULT 'RUNNING',
    "currentNodeId" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "resumeAt" TIMESTAMP(3),
    "dedupKey" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScenarioRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioRunStep" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "status" "ScenarioRunStatus" NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ScenarioRunStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Scenario_tenantId_idx" ON "Scenario"("tenantId");

-- CreateIndex
CREATE INDEX "Scenario_tenantId_status_idx" ON "Scenario"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Scenario_tenantId_triggerType_status_idx" ON "Scenario"("tenantId", "triggerType", "status");

-- CreateIndex
CREATE INDEX "ScenarioRun_tenantId_status_idx" ON "ScenarioRun"("tenantId", "status");

-- CreateIndex (resume tick: node-cron scans due WAITING runs)
CREATE INDEX "ScenarioRun_status_resumeAt_idx" ON "ScenarioRun"("status", "resumeAt");

-- CreateIndex
CREATE INDEX "ScenarioRun_conversationId_idx" ON "ScenarioRun"("conversationId");

-- CreateIndex (idempotency: one run per scenario + trigger ref)
CREATE UNIQUE INDEX "ScenarioRun_scenarioId_dedupKey_key" ON "ScenarioRun"("scenarioId", "dedupKey");

-- CreateIndex
CREATE INDEX "ScenarioRunStep_tenantId_runId_startedAt_idx" ON "ScenarioRunStep"("tenantId", "runId", "startedAt");

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioRun" ADD CONSTRAINT "ScenarioRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioRun" ADD CONSTRAINT "ScenarioRun_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioRun" ADD CONSTRAINT "ScenarioRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioRunStep" ADD CONSTRAINT "ScenarioRunStep_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioRunStep" ADD CONSTRAINT "ScenarioRunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ScenarioRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
