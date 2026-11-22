-- LID routing fix (2026-11-22): outbound sends look up the LID for a known
-- phone number (pn -> lid) so replies go lid->lid into LID-addressed chats.
-- Index the reverse direction the query filters on.
CREATE INDEX "LidMapping_channelId_pn_idx" ON "LidMapping"("channelId", "pn");
