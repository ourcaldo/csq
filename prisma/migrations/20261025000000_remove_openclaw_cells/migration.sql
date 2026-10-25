-- Remove OpenClaw cell/session columns: the agent runtime is now a direct
-- OpenAI-compatible client (services/llm-runtime.ts) — no sidecar, no cells.
ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "openclawCellId";
ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "openclawBaseUrl";
ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "openclawToken";
ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "cellStatus";
ALTER TABLE "Agent" DROP COLUMN IF EXISTS "openclawCellId";
ALTER TABLE "Agent" DROP COLUMN IF EXISTS "openclawAgentId";
ALTER TABLE "Conversation" DROP COLUMN IF EXISTS "openclawSessionId";
