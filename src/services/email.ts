import nodemailer from "nodemailer";

// SMTP email for the scenario `email` node — transactional customer email
// (order confirmations, receipts, follow-ups) sent to the Contact's email
// address. One service module per external integration (AGENTS.md); the
// scenario engine is the only caller and treats "not configured" as an
// explicit skip + audit, never a run failure.
//
// Configuration (env): SMTP_HOST, SMTP_PORT, SMTP_SECURE (true for 465),
// SMTP_USER, SMTP_PASS, SMTP_FROM (display sender, e.g. "Toko Kopi
// <no-reply@tokokopi.id>"). When SMTP_HOST is unset the module reports
// unconfigured and every send is skipped + audited by the caller — same
// degrade-gracefully contract as the embeddings service.
//
// Server-only. Secrets stay server-side.

const SMTP_HOST = process.env.SMTP_HOST ?? "";
const SMTP_PORT = Number(process.env.SMTP_PORT ?? "587");
const SMTP_SECURE = process.env.SMTP_SECURE === "true";
const SMTP_USER = process.env.SMTP_USER ?? "";
const SMTP_PASS = process.env.SMTP_PASS ?? "";
const SMTP_FROM =
  process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "";

// Lazily-created singleton transporter. Created on first send so an
// unconfigured env never constructs a transport at module load, and so env
// changes in dev (next dev hot-reload aside) don't cache a stale transporter.
let transporter: nodemailer.Transporter | null = null;

export function isEmailConfigured(): boolean {
  return Boolean(SMTP_HOST && SMTP_FROM);
}

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

// Send one plain-text email. Throws on transport failure; the scenario engine
// catches, skips, and audits. Body size is bounded by the email node's Zod
// schema (10 KB) before it ever reaches here.
export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ messageId: string }> {
  if (!isEmailConfigured()) {
    throw new Error("SMTP not configured");
  }
  const info = await getTransporter().sendMail({
    from: SMTP_FROM,
    to: input.to,
    subject: input.subject,
    text: input.text,
  });
  return { messageId: info.messageId };
}
