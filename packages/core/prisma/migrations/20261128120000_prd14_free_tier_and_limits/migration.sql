-- PRD 14 amendment 2026-11-28: Free tier and hard limits.
-- Plan.agentLimit / Plan.mediaBytesLimit: NULL = unlimited.
-- Free tier values: 1 agent, 500 MB (524288000 bytes) media.
-- Tenant.overduePlanId: the plan stashed when the overdue downgrade tick
-- cleared planId; NULL = not downgraded.

ALTER TABLE "Plan" ADD COLUMN "agentLimit" INTEGER;
ALTER TABLE "Plan" ADD COLUMN "mediaBytesLimit" INTEGER;
ALTER TABLE "Tenant" ADD COLUMN "overduePlanId" TEXT;
