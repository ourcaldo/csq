-- The Stage table was created with `kind TEXT` and no `StageKind` enum type.
-- Recreate it with the enum type. All pipeline tables are empty (no pipeline
-- seeded yet), so CASCADE drops lose no data — only the FK constraint on Deal.
CREATE TYPE "StageKind" AS ENUM ('OPENING', 'WON', 'LOST', 'NORMAL');

DROP TABLE "Stage" CASCADE;

CREATE TABLE "Stage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "winProbability" DOUBLE PRECISION,
    "expectedDays" INTEGER,
    "kind" "StageKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Stage_pipelineId_order_idx" ON "Stage"("pipelineId", "order");
CREATE INDEX "Stage_pipelineId_kind_idx" ON "Stage"("pipelineId", "kind");
CREATE INDEX "Stage_tenantId_idx" ON "Stage"("tenantId");
CREATE UNIQUE INDEX "Stage_pipelineId_kind_opening_won_lost_idx"
  ON "Stage"("pipelineId", "kind")
  WHERE "kind" IN ('OPENING', 'WON', 'LOST');

ALTER TABLE "Stage" ADD CONSTRAINT "Stage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Stage" ADD CONSTRAINT "Stage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Re-add the Deal→Stage FK that CASCADE dropped along with the Stage table.
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
