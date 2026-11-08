-- Enterprise plan Phase 6 (PRD 23C): the outbound outbox and the channel
-- command queue. Dashboard-initiated sends become rows the worker drains;
-- connect/QR/disconnect become commands the worker executes. Same
-- Postgres-as-queue pattern as the campaign tables. RLS policies follow the
-- D9 coverage rule: defined but inert until the documented activation path.

-- CreateEnum
CREATE TYPE "OutboundSource" AS ENUM ('REPLY', 'TEST', 'TEMPLATE_SEND');

-- CreateEnum
CREATE TYPE "OutboundStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChannelCommandKind" AS ENUM ('CONNECT', 'DISCONNECT');

-- CreateEnum
CREATE TYPE "ChannelCommandStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "toJid" TEXT NOT NULL,
    "body" TEXT,
    "templateName" TEXT,
    "language" TEXT,
    "source" "OutboundSource" NOT NULL,
    "status" "OutboundStatus" NOT NULL DEFAULT 'QUEUED',
    "waMessageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelCommand" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "kind" "ChannelCommandKind" NOT NULL,
    "status" "ChannelCommandStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "error" TEXT,
    "requestedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboundMessage_status_createdAt_idx" ON "OutboundMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_tenantId_idx" ON "OutboundMessage"("tenantId");

-- CreateIndex
CREATE INDEX "ChannelCommand_status_createdAt_idx" ON "ChannelCommand"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ChannelCommand_tenantId_idx" ON "ChannelCommand"("tenantId");

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelCommand" ADD CONSTRAINT "ChannelCommand_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelCommand" ADD CONSTRAINT "ChannelCommand_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- D9: RLS coverage for the two new tenant tables (inert until activation).
ALTER TABLE "OutboundMessage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "OutboundMessage_tenant_isolation" ON "OutboundMessage" FOR ALL USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
ALTER TABLE "ChannelCommand" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ChannelCommand_tenant_isolation" ON "ChannelCommand" FOR ALL USING ("tenantId" = current_setting('app.current_tenant_id', true)) WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));
