-- Pipeline revamp (owner request 2026-11-16): estimated deal value shown on
-- cards, stage totals, and the pipeline header. Whole rupiah.
ALTER TABLE "Deal" ADD COLUMN "value" INTEGER NOT NULL DEFAULT 0;
