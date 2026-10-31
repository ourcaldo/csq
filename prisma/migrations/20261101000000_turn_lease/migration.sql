-- AlterConversation: per-conversation turn lease columns (D1).
-- The lease serializes agent turns without holding a Postgres transaction
-- (and a pooled connection) across LLM HTTP latency. All reads/writes go
-- through src/lib/turn-lock.ts only.
ALTER TABLE "Conversation" ADD COLUMN "turnLockId" TEXT,
ADD COLUMN "turnLockedAt" TIMESTAMP(3);
