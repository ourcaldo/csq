import prisma from "@/lib/db";
import type { OAuthCredentials } from "@/types/sheets";

// Tenant-level Google OAuth token store (PRD §8.3). One Google connection
// per tenant - NOT per DataSource. This is what lets the owner add a second
// spreadsheet without re-logging-in: the connection is shared across every
// GOOGLE_SHEETS source, and the Connect/Disconnect button has a single
// source of truth.
//
// D10c: credentials live in the dedicated TenantCredential table, NOT in
// Tenant.settings. Settings is a config blob several routes read-merge-write,
// so keeping tokens there made any future `select settings` a credential
// leak. The legacy `settings.googleSheets` key was copied here by migration
// 20261101000600 and dropped from Tenant.settings by migration
// 20261101000900 (owner-approved 2026-11-01); this table is now the only
// place tokens exist.
//
// Server-only. Tokens are server secrets; never sent to the client (the
// public status exposes only `connected` + `email`).

const GOOGLE_PROVIDER = "google";

// Read the Google connection for a tenant. Returns the OAuth credentials (for
// server-side googleapis calls) or null when not connected.
export async function getGoogleCreds(
  tenantId: string
): Promise<OAuthCredentials | null> {
  const row = await prisma.tenantCredential.findFirst({
    where: { tenantId, provider: GOOGLE_PROVIDER },
  });
  if (!row) return null;
  return {
    accessToken: row.accessToken,
    refreshToken: row.refreshToken ?? undefined,
    expiryDate: row.expiryDate?.getTime(),
  };
}

// Persist the Google connection on the tenant. Upsert keyed on
// (tenantId, provider) - reconnecting replaces the previous tokens.
export async function setGoogleCreds(
  tenantId: string,
  creds: OAuthCredentials,
  email?: string
): Promise<void> {
  await prisma.tenantCredential.upsert({
    where: { tenantId_provider: { tenantId, provider: GOOGLE_PROVIDER } },
    create: {
      tenantId,
      provider: GOOGLE_PROVIDER,
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken ?? null,
      expiryDate: creds.expiryDate ? new Date(creds.expiryDate) : null,
      email: email ?? null,
    },
    update: {
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken ?? null,
      expiryDate: creds.expiryDate ? new Date(creds.expiryDate) : null,
      email: email ?? null,
    },
  });
}

// Remove the Google connection (Disconnect).
export async function clearGoogleCreds(tenantId: string): Promise<void> {
  await prisma.tenantCredential.deleteMany({
    where: { tenantId, provider: GOOGLE_PROVIDER },
  });
}

// Public status for the dashboard button. Exposes only connected + email -
// never the tokens.
export async function isGoogleConnected(
  tenantId: string
): Promise<{ connected: boolean; email?: string }> {
  const row = await prisma.tenantCredential.findFirst({
    where: { tenantId, provider: GOOGLE_PROVIDER },
    select: { email: true },
  });
  if (!row) return { connected: false };
  return { connected: true, email: row.email ?? undefined };
}
