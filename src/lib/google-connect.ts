import { z } from "zod";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import type { OAuthCredentials } from "@/types/sheets";

// Tenant-level Google OAuth token store (PRD §8.3). One Google connection
// per tenant, stored in `Tenant.settings.googleSheets` (Json) — NOT per
// DataSource. This is what lets the owner add a second spreadsheet without
// re-logging-in: the connection is shared across every GOOGLE_SHEETS source,
// and the Connect/Disconnect button has a single source of truth.
//
// Server-only. Tokens are server secrets; never sent to the client (the public
// endpoint exposes only `connected` + `email`). Settings is read-merge-written
// so other settings keys are preserved, and parsed with Zod at every read —
// the Json column is an external boundary (no `as`).

// Shape stored under Tenant.settings.googleSheets.
export const googleCredsSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiryDate: z.number().optional(),
  email: z.string().optional(),
});
export type StoredGoogleCreds = z.infer<typeof googleCredsSchema>;

// Tenant.settings is a Json column — parse it into a plain record so we can
// merge without `as`. Falls back to {} when null/missing/non-object.
const settingsRecordSchema = z.record(z.unknown());
type TenantSettings = Record<string, unknown>;

function asSettings(raw: unknown): TenantSettings {
  const parsed = settingsRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

// Coerce a settings record to a Prisma InputJsonValue for the write. Same
// pattern as toJson in src/tools/execute.ts — round-tripping through JSON
// yields a JSON-serializable value assignable to InputJsonValue without a
// type assertion.
function toJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v));
}

// Read the Google connection for a tenant. Returns the OAuth credentials (for
// server-side googleapis calls) or null when not connected.
export async function getGoogleCreds(
  tenantId: string
): Promise<OAuthCredentials | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  if (!tenant) return null;
  const parsed = googleCredsSchema.safeParse(asSettings(tenant.settings).googleSheets);
  if (!parsed.success) return null;
  const c = parsed.data;
  return {
    accessToken: c.accessToken,
    refreshToken: c.refreshToken,
    expiryDate: c.expiryDate,
  };
}

// Persist the Google connection on the tenant. Merges into existing settings
// without dropping other keys.
export async function setGoogleCreds(
  tenantId: string,
  creds: OAuthCredentials,
  email?: string
): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  const settings = asSettings(tenant?.settings);
  settings.googleSheets = {
    accessToken: creds.accessToken,
    refreshToken: creds.refreshToken,
    expiryDate: creds.expiryDate,
    email,
  };
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { settings: toJson(settings) },
  });
}

// Remove the Google connection (Disconnect). Other settings keys are preserved.
export async function clearGoogleCreds(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  const settings = asSettings(tenant?.settings);
  delete settings.googleSheets;
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { settings: toJson(settings) },
  });
}

// Public status for the dashboard button. Exposes only connected + email —
// never the tokens.
export async function isGoogleConnected(
  tenantId: string
): Promise<{ connected: boolean; email?: string }> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  if (!tenant) return { connected: false };
  const parsed = googleCredsSchema.safeParse(asSettings(tenant.settings).googleSheets);
  if (!parsed.success) return { connected: false };
  return { connected: true, email: parsed.data.email };
}
