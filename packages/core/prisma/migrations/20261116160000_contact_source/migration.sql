-- Lead source (owner request 2026-11-16): where a customer came from, e.g.
-- "Placement Test" from an API integration, an API key name, or "Input Manual".
ALTER TABLE "Contact" ADD COLUMN "source" TEXT;
