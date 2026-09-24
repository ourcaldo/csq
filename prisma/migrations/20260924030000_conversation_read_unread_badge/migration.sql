-- DropIndex
DROP INDEX "Product_tenantId_sku_idx";

-- AlterTable
ALTER TABLE "InventorySnapshot" DROP COLUMN "source",
ADD COLUMN     "source" "InventorySource" NOT NULL;

-- CreateTable
CREATE TABLE "ConversationRead" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationRead_tenantId_idx" ON "ConversationRead"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationRead_conversationId_userId_key" ON "ConversationRead"("conversationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "InventorySnapshot_tenantId_productId_source_key" ON "InventorySnapshot"("tenantId", "productId", "source");

-- AddForeignKey
ALTER TABLE "ConversationRead" ADD CONSTRAINT "ConversationRead_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationRead" ADD CONSTRAINT "ConversationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationRead" ADD CONSTRAINT "ConversationRead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "Deal_conversationId_idx" RENAME TO "Deal_conversationId_key";

