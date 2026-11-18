-- Cross-tenant channel identity (audit run-1, needs-validation lead
-- channel-externalid-cross-tenant-race): "one phone number ID belongs to
-- exactly one tenant" was enforced only by a check-then-act scan in
-- connect.ts. This partial global unique index makes the DB the authority;
-- Postgres NULL handling keeps pre-pairing Baileys rows valid.

CREATE UNIQUE INDEX "Channel_provider_externalId_global_key"
  ON "Channel"(provider, "externalId")
  WHERE "externalId" IS NOT NULL;
