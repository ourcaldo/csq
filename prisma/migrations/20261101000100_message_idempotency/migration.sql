-- D3: inbound idempotency. Meta redelivers webhook posts (at-least-once), and
-- a redelivery must never store a second Message row or trigger a second
-- agent turn. Partial unique index: (tenantId, waMessageId) where not null.
-- Prisma cannot express a partial unique index in schema.prisma; the index is
-- documented there as a comment. Duplicate rows were deduplicated before this
-- migration ran (keep the earliest row of each group).
CREATE UNIQUE INDEX "Message_tenantId_waMessageId_key"
ON "Message" ("tenantId", "waMessageId")
WHERE "waMessageId" IS NOT NULL;
