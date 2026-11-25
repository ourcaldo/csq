-- PRD 31: Pengetahuan kategori + FAQ pair grouping.
-- groupId is NOT NULL in the Prisma model; every entry has one. FAQ entries
-- share a groupId across their pair rows (one row per Q&A pair, so each pair
-- keeps its own KnowledgeEmbedding).

ALTER TABLE "Knowledge" ADD COLUMN "category" TEXT;
ALTER TABLE "Knowledge" ADD COLUMN "groupId" TEXT;

-- Existing rows become groups of one (id as its own groupId).
UPDATE "Knowledge" SET "groupId" = "id";

ALTER TABLE "Knowledge" ALTER COLUMN "groupId" SET NOT NULL;

CREATE INDEX "Knowledge_tenantId_groupId_idx" ON "Knowledge"("tenantId", "groupId");
