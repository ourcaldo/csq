-- Enterprise plan Phase 2 (PRD 13): tenant lifecycle. The TenantStatus
-- enum drives suspension semantics: suspended tenants lock their users
-- out, the agent stands down, the worker disconnects their channels,
-- but inbound WhatsApp messages keep ingesting (data is never lost).

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE';
