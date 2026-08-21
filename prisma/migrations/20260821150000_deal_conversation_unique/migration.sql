-- The Deal↔Conversation relation is 1:1, which requires `conversationId` to be
-- unique (Prisma's 1:1 rule). The initial pipeline migration used a composite
-- unique on (tenantId, conversationId); swap it for a standalone unique on
-- conversationId, which is stricter and satisfies the 1:1 relation. Since a
-- conversation belongs to exactly one tenant, this is equivalent to the composite.
DROP INDEX "Deal_tenantId_conversationId_idx";

CREATE UNIQUE INDEX "Deal_conversationId_idx" ON "Deal"("conversationId");
