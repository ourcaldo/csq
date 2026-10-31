-- D10b: one pipeline per tenant, enforced by the database. getOrCreatePipeline
-- was check-then-create with no constraint, so two concurrent first-turns (two
-- agents, or an agent plus the dashboard) could seed two pipelines. Verified no
-- tenant has more than one pipeline before this ran. Auto-merging duplicates
-- here would be unsafe (cascading stages are Restrict-ed by Deal.stageId), so
-- the index simply fails loudly on a duplicated database.
CREATE UNIQUE INDEX "Pipeline_tenantId_key" ON "Pipeline"("tenantId");

-- DropIndex: superseded by the unique index above.
DROP INDEX "Pipeline_tenantId_idx";
