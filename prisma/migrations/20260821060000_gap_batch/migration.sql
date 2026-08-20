-- Gap batch (G1, G4, G8): approval routing, memory key uniqueness, per-source inventory snapshots.

-- G1: route approval result back to the originating conversation/customer.
ALTER TABLE "Approval" ADD COLUMN "conversationId" TEXT,
  ADD COLUMN "channelId" TEXT,
  ADD COLUMN "customerPhone" TEXT;
CREATE INDEX "Approval_conversationId_idx" ON "Approval" ("conversationId");
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- G4: memory key uniqueness per (tenant, agent) so memory.create upserts by key
-- instead of allowing duplicate (agentId, key) rows.
CREATE UNIQUE INDEX "Memory_tenantId_agentId_key_key"
  ON "Memory" ("tenantId", "agentId", "key");

-- G8: per-source inventory snapshots so Tenant.settings.sourcePriority can
-- arbitrate conflicts. The canonical "Inventory" row holds the resolved
-- quantity; these snapshots hold each source's contribution.
CREATE TABLE "InventorySnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sourceRef" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventorySnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InventorySnapshot_tenantId_productId_source_key"
  ON "InventorySnapshot" ("tenantId", "productId", "source");
CREATE INDEX "InventorySnapshot_tenantId_productId_idx"
  ON "InventorySnapshot" ("tenantId", "productId");
ALTER TABLE "InventorySnapshot" ADD CONSTRAINT "InventorySnapshot_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventorySnapshot" ADD CONSTRAINT "InventorySnapshot_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
