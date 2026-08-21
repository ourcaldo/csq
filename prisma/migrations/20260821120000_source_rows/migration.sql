-- CreateTable
CREATE TABLE "SourceRow" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourceRow_tenantId_dataSourceId_idx" ON "SourceRow"("tenantId", "dataSourceId");

-- AddForeignKey
ALTER TABLE "SourceRow" ADD CONSTRAINT "SourceRow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRow" ADD CONSTRAINT "SourceRow_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
