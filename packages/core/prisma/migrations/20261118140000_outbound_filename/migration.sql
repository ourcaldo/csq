-- Document sends (PRD 24 amendment 2026-11-18): the filename the customer
-- sees on the document bubble. OutboundMessage carries it for the worker's
-- provider send; Message carries it so the inbox renders a file card.
ALTER TABLE "OutboundMessage" ADD COLUMN "filename" TEXT;
ALTER TABLE "Message" ADD COLUMN "filename" TEXT;
