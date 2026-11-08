-- Feature plan 2026-11-01, section 3.4: campaigns, media assets, and the
-- per-staff campaign permission. RLS policies for the four new tenant tables
-- follow the D9 coverage rule (inert until the documented activation path).

-- AlterEnum: campaign sends are their own sender type in the inbox.
ALTER TYPE "MessageSenderType" ADD VALUE 'CAMPAIGN';

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CampaignAudience" AS ENUM ('ALL', 'CATEGORY', 'TAGS', 'MANUAL');

-- CreateEnum
CREATE TYPE "CampaignScheduleKind" AS ENUM ('ONCE', 'DAILY', 'WEEKLY', 'MONTHLY', 'INTERVAL');

-- CreateEnum
CREATE TYPE "CampaignSendKind" AS ENUM ('BODY', 'META_TEMPLATE');

-- CreateEnum
CREATE TYPE "CampaignMessageStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "audience" "CampaignAudience" NOT NULL,
    "categoryIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "tagIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "contactIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "sendKind" "CampaignSendKind" NOT NULL,
    "body" TEXT NOT NULL,
    "imageIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "metaName" TEXT,
    "metaLanguage" TEXT,
    "scheduleKind" "CampaignScheduleKind" NOT NULL,
    "scheduleConfig" JSONB NOT NULL DEFAULT '{}',
    "delaySeconds" INTEGER NOT NULL DEFAULT 30,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP?,
    "counts" JSONB,

    CONSTRAINT "CampaignRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "CampaignMessageStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "waMessageId" TEXT,
    "reason" TEXT,

    CONSTRAINT "CampaignMessage_pkey" PRIMARY KEY ("id")
);

-- AlterTable: per-staff campaign permission (plan decision 2.2).
ALTER TABLE "User" ADD COLUMN "canRunCampaigns" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "MediaAsset_tenantId_createdAt_idx" ON "MediaAsset"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Campaign_tenantId_status_nextRunAt_idx" ON "Campaign"("tenantId", "status", "nextRunAt");

-- CreateIndex
CREATE INDEX "CampaignRun_tenantId_campaignId_startedAt_idx" ON "CampaignRun"("tenantId", "campaignId", "startedAt");

-- CreateIndex
CREATE INDEX "CampaignMessage_runId_status_scheduledFor_idx" ON "CampaignMessage"("runId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "CampaignMessage_tenantId_runId_idx" ON "CampaignMessage"("tenantId", "runId");

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRun" ADD CONSTRAINT "CampaignRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRun" ADD CONSTRAINT "CampaignRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMessage" ADD CONSTRAINT "CampaignMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMessage" ADD CONSTRAINT "CampaignMessage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CampaignRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- D9 coverage rule for the new tenant tables. MediaAsset carries tenantId and
-- is covered; "User" already has a policy (the new column rides on it).
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
