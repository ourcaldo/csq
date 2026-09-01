import { z } from "zod";
import nodemailer from "nodemailer";
import {
  emailProviderSchema,
  type EmailProviderConfig,
} from "@/lib/email-config";

// Per-tenant email delivery for the scenario Email module — transactional
// customer email (order confirmations, receipts, follow-ups) sent through the
// store owner's own provider, configured on the Settings page: their SMTP or a
// Resend API key (src/lib/email-config.ts owns the stored shape). One service
// module per external integration (AGENTS.md); callers (the scenario engine,
// the settings test route) treat "no provider configured" as an explicit skip
// + audit, never a silent drop and never a run failure.
//
// Server-only. Credentials stay server-side; the client only ever sees masked
// status flags. No `as` casts: external responses are Zod-parsed at the
// boundary.

// ─────────────────────────── Resend (HTTP API, no SDK) ───────────────────────────

const RESEND_BASE_URL = process.env.RESEND_BASE_URL ?? "https://api.resend.com";

const resendSendResponseSchema = z
  .object({ id: z.string().optional() })
  .passthrough();

async function sendViaResend(
  config: Extract<EmailProviderConfig, { type: "RESEND" }>,
  input: { to: string; subject: string; text: string }
): Promise<{ messageId: string }> {
  const res = await fetch(`${RESEND_BASE_URL}/emails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      from: config.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend gagal: ${res.status} ${res.statusText}`);
  }
  const parsed = resendSendResponseSchema.parse(await res.json());
  return { messageId: parsed.id ?? "" };
}

// ─────────────────────────── SMTP (nodemailer) ───────────────────────────

// Transporter cache keyed by the config's stable signature. Bounded: at
// MAX_TRANSPORTERS entries the cache resets, so a tenant changing credentials
// never leaks an unbounded set of pooled sockets (each signature maps to one
// transporter; the fresh config always wins).
const MAX_TRANSPORTERS = 32;
const transporters = new Map<string, nodemailer.Transporter>();

function smtpSignature(config: Extract<EmailProviderConfig, { type: "SMTP" }>): string {
  return [
    config.host,
    config.port,
    config.secure ? "1" : "0",
    config.username,
    config.password,
  ].join("|");
}

function smtpTransporter(
  config: Extract<EmailProviderConfig, { type: "SMTP" }>
): nodemailer.Transporter {
  const key = smtpSignature(config);
  const cached = transporters.get(key);
  if (cached) return cached;
  if (transporters.size >= MAX_TRANSPORTERS) transporters.clear();
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.username ? { user: config.username, pass: config.password } : undefined,
  });
  transporters.set(key, transporter);
  return transporter;
}

async function sendViaSmtp(
  config: Extract<EmailProviderConfig, { type: "SMTP" }>,
  input: { to: string; subject: string; text: string }
): Promise<{ messageId: string }> {
  const info = await smtpTransporter(config).sendMail({
    from: config.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
  });
  return { messageId: info.messageId };
}

// ─────────────────────────── Public API ───────────────────────────

// Validate an unknown value into a provider config (settings route input,
// engine re-read). Returns null on an invalid/absent shape.
export function parseEmailProvider(raw: unknown): EmailProviderConfig | null {
  const parsed = emailProviderSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// Send one plain-text email through the tenant's configured provider. Throws
// on transport failure; callers skip + audit. Body size is bounded by the
// email node's Zod schema (10 KB) before it ever reaches here.
export async function sendEmailWithProvider(
  config: EmailProviderConfig,
  input: { to: string; subject: string; text: string }
): Promise<{ messageId: string }> {
  if (config.type === "RESEND") return sendViaResend(config, input);
  return sendViaSmtp(config, input);
}
