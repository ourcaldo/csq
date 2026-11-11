-- Customer scoping for agent memories (owner decision 2026-11-11, PRD 03
-- amendment): a memory belongs to one customer. The column is stamped
-- server-side from the conversation; search and HIGH-importance prompt
-- injection filter by it, so the agent can never read another customer's
-- memories. Existing rows were a day of test data - wiped per the owner's
-- approval of the recommendation, no backfill guessing.

ALTER TABLE "Memory" ADD COLUMN "customerPhone" TEXT;
DELETE FROM "Memory";
DROP INDEX "Memory_tenantId_agentId_key_key";
CREATE UNIQUE INDEX "Memory_tenantId_agentId_customerPhone_key_key"
    ON "Memory"("tenantId", "agentId", "customerPhone", "key");
