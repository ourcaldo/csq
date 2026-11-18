-- Multi-channel identity (PRD 15, owner go 2026-11-18): identity moves out
-- of the config JSON into columns; config keeps secrets only. externalId =
-- Cloud API phone number ID or Baileys paired phone. Postgres unique allows
-- multiple NULLs, so a Baileys channel stays valid before pairing.

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN "label" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Channel" ADD COLUMN "phoneNumber" TEXT;
ALTER TABLE "Channel" ADD COLUMN "externalId" TEXT;
ALTER TABLE "Channel" ADD COLUMN "wabaId" TEXT;
ALTER TABLE "Channel" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Backfill (PRD 15 migration): label from the provider name, externalId +
-- display number from the Cloud API config. Baileys externalId stays NULL
-- until the next pairing writes it.
UPDATE "Channel" SET
  "label" = CASE "provider"
    WHEN 'CLOUD_API' THEN 'WhatsApp Resmi'
    WHEN 'BAILEYS' THEN 'WhatsApp Pribadi'
    ELSE 'WhatsApp'
  END
WHERE "label" = '';
UPDATE "Channel" SET
  "externalId" = config->>'phoneNumberId'
WHERE "provider" = 'CLOUD_API'
  AND "externalId" IS NULL
  AND config->>'phoneNumberId' IS NOT NULL;

-- CreateIndex: one provider identity per tenant. Non-partial unique: the
-- Postgres NULL rule covers pre-pairing Baileys rows.
CREATE UNIQUE INDEX "Channel_tenantId_provider_externalId_key"
  ON "Channel"("tenantId", "provider", "externalId");
