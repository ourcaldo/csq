-- LID -> phone-number mapping for Baileys channels. Sends to a raw
-- "<lid>@lid" JID are accepted by WhatsApp but never delivered on Baileys
-- 6.7.x (WhiskeySockets/Baileys#1950, #1964 - the fix landed in v7 only).
-- Inbound messages carry the sender's real number (key.senderPn); it is
-- captured here so outbound sends and the dashboard resolve the real phone
-- number. Keyed by channel: the LID rotates on every device re-pair.

-- CreateTable
CREATE TABLE "LidMapping" (
    "channelId" TEXT NOT NULL,
    "lid" TEXT NOT NULL,
    "pn" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LidMapping_pkey" PRIMARY KEY ("channelId", "lid")
);
