-- PRD 27: contact WhatsApp profile photos (Baileys-only fetch, worker side).
-- Scalar column + relation to MediaAsset; SetNull keeps the contact when the
-- media row goes away.
ALTER TABLE "Contact" ADD COLUMN "avatarMediaId" TEXT;

ALTER TABLE "Contact" ADD CONSTRAINT "Contact_avatarMediaId_fkey"
  FOREIGN KEY ("avatarMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Contact_avatarMediaId_idx" ON "Contact"("avatarMediaId");
