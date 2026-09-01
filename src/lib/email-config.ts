import { z } from "zod";
import prisma from "@/lib/db";

// Per-tenant email delivery config for the scenario Email module. Each store
// owner sets this up on the Settings page (PRD: external integrations are the
// owner's to bring) — either their own SMTP or a Resend API key. Stored in
// Tenant.settings.emailProvider (a Json column), the same pattern as
// sourcePriority and Channel.config: read/written through Zod (never `as`),
// secrets never leave the server except as masked flags.
//
// This module is the single source of truth for the stored shape; the settings
// route and services/email.ts both import from here.

// ─────────────────────────── Stored shape ───────────────────────────

// Loose "is an email address" check — provider-side validation is the real
// authority; this only stops obvious garbage at the boundary.
const emailAddress = z
  .string()
  .min(3)
  .max(320)
  .refine((v) => v.includes("@") && !v.startsWith("@") && !v.endsWith("@"), {
    message: "Alamat email tidak valid.",
  });

export const smtpProviderSchema = z.object({
  type: z.literal("SMTP"),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().max(255),
  password: z.string().min(1).max(255),
  from: emailAddress,
});

export const resendProviderSchema = z.object({
  type: z.literal("RESEND"),
  apiKey: z.string().min(1).max(255),
  from: emailAddress,
});

export const emailProviderSchema = z.discriminatedUnion("type", [
  smtpProviderSchema,
  resendProviderSchema,
]);
export type EmailProviderConfig = z.infer<typeof emailProviderSchema>;

// Permissive read shape for the whole settings blob — preserves unrelated
// keys (sourcePriority, …) on write.
const storedSettingsSchema = z.object({}).passthrough();

// ─────────────────────────── Read / write ───────────────────────────

// Read the tenant's email provider config. Returns null when unset or stored
// in an invalid shape (treated as unconfigured — the Email module skips +
// audits, and the Settings page shows "not connected" so the owner can fix it).
export async function getEmailProvider(
  tenantId: string
): Promise<EmailProviderConfig | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  if (!tenant) return null;
  return parseStoredProvider(tenant.settings);
}

// Pure variant over a settings JSON value (for tests / callers that already
// hold the Tenant row).
export function parseStoredProvider(settings: unknown): EmailProviderConfig | null {
  const parsed = storedSettingsSchema.safeParse(settings ?? {});
  if (!parsed.success) return null;
  const raw = parsed.data["emailProvider"];
  const provider = emailProviderSchema.safeParse(raw);
  return provider.success ? provider.data : null;
}

// Save the config onto Tenant.settings.emailProvider, merging with the
// existing settings so unrelated keys survive.
export async function saveEmailProvider(
  tenantId: string,
  config: EmailProviderConfig
): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  if (!tenant) throw new Error("Tenant tidak ditemukan.");
  const existing = storedSettingsSchema.safeParse(tenant.settings ?? {});
  const base = existing.success ? existing.data : {};
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { settings: { ...base, emailProvider: config } },
  });
}

// Disconnect: remove emailProvider from settings, preserving other keys.
export async function clearEmailProvider(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  if (!tenant) throw new Error("Tenant tidak ditemukan.");
  const existing = storedSettingsSchema.safeParse(tenant.settings ?? {});
  const base = existing.success ? existing.data : {};
  delete base["emailProvider"];
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { settings: base },
  });
}

// ─────────────────────────── Masked view (GET) ───────────────────────────
// What the Settings page may see: everything except the secret, which is
// reduced to a boolean so the client can show "saved" without ever receiving
// the credential.
export type EmailProviderStatus = {
  configured: true;
  type: "SMTP" | "RESEND";
  from: string;
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  hasSecret: true;
};

export function maskEmailProvider(config: EmailProviderConfig): EmailProviderStatus {
  if (config.type === "SMTP") {
    return {
      configured: true,
      type: "SMTP",
      from: config.from,
      host: config.host,
      port: config.port,
      secure: config.secure,
      username: config.username,
      hasSecret: true,
    };
  }
  return { configured: true, type: "RESEND", from: config.from, hasSecret: true };
}
