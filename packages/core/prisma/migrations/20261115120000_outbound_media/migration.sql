-- Outbound messaging API (PRD 24): image sends through the worker outbox.
-- The MediaAsset holds the bytes; `body` carries the caption when set.
ALTER TABLE "OutboundMessage" ADD COLUMN "mediaId" TEXT;
