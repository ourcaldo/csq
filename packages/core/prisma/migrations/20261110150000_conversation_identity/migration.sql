-- One thread per customer identity (owner request 2026-11-10): the same
-- person must not appear as separate conversations for a LID vs phone JID or
-- for two channels (Pribadi / Resmi). Conversations are now unique per
-- (tenantId, customerPhone) with customerPhone stored as bare phone digits
-- when known; channelId tracks the channel of the LATEST message.
--
-- Order matters: the OLD unique index (tenantId, channelId, customerPhone)
-- must go first - normalizing "628...@s.whatsapp.net" to "628..." can collide
-- with an existing bare-digit row on the same channel until the merge below
-- removes the duplicate.
--
--   1. drop the old unique index
--   2. "628...@s.whatsapp.net" -> "628..."
--   3. "<lid>@lid" -> the mapped phone digits (LidMapping, captured from
--      inbound key.senderPn), when a mapping exists for that channel
--   4. merge conversations sharing (tenantId, customerPhone): keep the most
--      recently active one, repoint every child row, drop the duplicates
--   5. create the new unique index

-- 1. Old identity rule out of the way (re-created as the new rule below).
DROP INDEX "Conversation_tenantId_channelId_customerPhone_key";

-- 2. PN JIDs to bare digits (strip any ":device" suffix too).
UPDATE "Conversation"
SET "customerPhone" = split_part(split_part("customerPhone", '@', 1), ':', 1)
WHERE "customerPhone" LIKE '%@s.whatsapp.net';

-- 3. LID to the mapped phone digits.
UPDATE "Conversation" c
SET "customerPhone" = lm.pn
FROM "LidMapping" lm
WHERE lm."channelId" = c."channelId"
  AND c."customerPhone" = lm.lid || '@lid';

-- 4. Merge duplicates.
DO $$
DECLARE
  grp RECORD;
  keeper text;
  dupe RECORD;
BEGIN
  FOR grp IN
    SELECT "tenantId", "customerPhone"
    FROM "Conversation"
    GROUP BY 1, 2
    HAVING count(*) > 1
  LOOP
    SELECT id INTO keeper
    FROM "Conversation"
    WHERE "tenantId" = grp."tenantId" AND "customerPhone" = grp."customerPhone"
    ORDER BY COALESCE("lastMessageAt", "createdAt") DESC, "createdAt" DESC
    LIMIT 1;

    FOR dupe IN
      SELECT id FROM "Conversation"
      WHERE "tenantId" = grp."tenantId" AND "customerPhone" = grp."customerPhone"
        AND id <> keeper
    LOOP
      -- Children that simply follow the keeper.
      UPDATE "Message" SET "conversationId" = keeper WHERE "conversationId" = dupe.id;
      UPDATE "ScenarioRun" SET "conversationId" = keeper WHERE "conversationId" = dupe.id;
      UPDATE "Approval" SET "conversationId" = keeper WHERE "conversationId" = dupe.id;
      UPDATE "SupportTicket" SET "conversationId" = keeper WHERE "conversationId" = dupe.id;

      -- Unique per conversation: move only rows the keeper does not have,
      -- then delete the remainder so the conversation delete is clean.
      UPDATE "ConversationTag" ct SET "conversationId" = keeper
      WHERE ct."conversationId" = dupe.id
        AND NOT EXISTS (
          SELECT 1 FROM "ConversationTag" k
          WHERE k."conversationId" = keeper AND k."tagId" = ct."tagId"
        );
      DELETE FROM "ConversationTag" WHERE "conversationId" = dupe.id;

      UPDATE "ConversationRead" cr SET "conversationId" = keeper
      WHERE cr."conversationId" = dupe.id
        AND NOT EXISTS (
          SELECT 1 FROM "ConversationRead" k
          WHERE k."conversationId" = keeper AND k."userId" = cr."userId"
        );
      DELETE FROM "ConversationRead" WHERE "conversationId" = dupe.id;

      -- One deal per conversation: keep the keeper's deal when both have one.
      UPDATE "Deal" d SET "conversationId" = keeper
      WHERE d."conversationId" = dupe.id
        AND NOT EXISTS (SELECT 1 FROM "Deal" k WHERE k."conversationId" = keeper);
      DELETE FROM "Deal" WHERE "conversationId" = dupe.id;

      DELETE FROM "Conversation" WHERE id = dupe.id;
    END LOOP;

    -- The merged thread's recency is its newest message.
    UPDATE "Conversation" c
    SET "lastMessageAt" = COALESCE(
      (SELECT max(m."createdAt") FROM "Message" m WHERE m."conversationId" = c.id),
      c."lastMessageAt"
    )
    WHERE c.id = keeper;
  END LOOP;
END $$;

-- 5. One thread per customer identity, across channels.
CREATE UNIQUE INDEX "Conversation_tenantId_customerPhone_key"
  ON "Conversation"("tenantId", "customerPhone");
