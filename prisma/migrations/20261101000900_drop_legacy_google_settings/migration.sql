-- D10c follow-up (approved 2026-11-01): drop the legacy Google OAuth tokens
-- from Tenant.settings. They were copied into the TenantCredential table by
-- migration 20261101000600_tenant_credential and verified there (row present,
-- token prefix, refresh token, expiry), and google-connect.ts now reads only
-- the new table. The key was kept until the new read path shipped; it is dead
-- data now, and leaving secrets in a config blob that several routes
-- read-merge-write is exactly what D10c closed.
UPDATE "Tenant"
SET settings = settings - 'googleSheets'
WHERE settings ? 'googleSheets';
