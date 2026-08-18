-- tenant_id on every table from day one (CLAUDE.md non-negotiable).
-- Add tenantId to the 3 junction/child tables that lacked it, backfilling from
-- their parent row, and switch Inventory uniqueness from global productId to
-- tenant-scoped (tenantId, productId).

-- ─────────────────────────── OrderItem ───────────────────────────
ALTER TABLE "OrderItem" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT '';
UPDATE "OrderItem" SET "tenantId" = (
  SELECT o."tenantId" FROM "Order" o WHERE o."id" = "OrderItem"."orderId"
);
ALTER TABLE "OrderItem" ALTER COLUMN "tenantId" DROP DEFAULT;
CREATE INDEX "OrderItem_tenantId_idx" ON "OrderItem"("tenantId");
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────── AgentCapability ───────────────────────────
ALTER TABLE "AgentCapability" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT '';
UPDATE "AgentCapability" SET "tenantId" = (
  SELECT a."tenantId" FROM "Agent" a WHERE a."id" = "AgentCapability"."agentId"
);
ALTER TABLE "AgentCapability" ALTER COLUMN "tenantId" DROP DEFAULT;
CREATE INDEX "AgentCapability_tenantId_idx" ON "AgentCapability"("tenantId");
ALTER TABLE "AgentCapability" ADD CONSTRAINT "AgentCapability_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────── ConversationTag ───────────────────────────
ALTER TABLE "ConversationTag" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT '';
UPDATE "ConversationTag" SET "tenantId" = (
  SELECT c."tenantId" FROM "Conversation" c WHERE c."id" = "ConversationTag"."conversationId"
);
ALTER TABLE "ConversationTag" ALTER COLUMN "tenantId" DROP DEFAULT;
CREATE INDEX "ConversationTag_tenantId_idx" ON "ConversationTag"("tenantId");
ALTER TABLE "ConversationTag" ADD CONSTRAINT "ConversationTag_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────── Inventory ───────────────────────────
-- Add a tenant-scoped composite unique alongside the existing global
-- productId @unique (kept for the 1:1 Product↔Inventory relation).
CREATE UNIQUE INDEX "Inventory_tenantId_productId_key" ON "Inventory"("tenantId", "productId");
