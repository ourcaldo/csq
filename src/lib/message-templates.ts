import { z } from "zod";
import prisma from "@/lib/db";
import type { Prisma } from "@prisma/client";

// Per-tenant message templates, stored in Tenant.settings.messageTemplates
// (Json column) — same pattern as emailProvider/googleSheets.
//
// Two kinds:
// - CSQ: free-form text shortcuts the system sends INSIDE the 24h WhatsApp
//   customer-service window (session-close greeting, agent fallback, etc.).
//   No Meta approval needed — Meta only requires pre-approved templates for
//   business-initiated messages OUTSIDE the 24h window.
// - META: the NAME (+ language) of a template that has been approved in Meta
//   Business Manager. Used when the system must reach a customer outside the
//   24h window (proactive follow-ups >24h after their last inbound).

export const templateKindSchema = z.enum(["CSQ", "META"]);
export type TemplateKind = z.infer<typeof templateKindSchema>;

export const messageTemplateSchema = z.object({
  id: z.string().uuid(),
  // Stable key the system reads (session_end, agent_fallback, window_greeting).
  // Custom keys are allowed for scenario/shortcut use.
  key: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9_]+$/, "huruf kecil, angka, underscore"),
  label: z.string().min(1).max(80),
  kind: templateKindSchema,
  // CSQ: the literal message body sent to the customer.
  body: z.string().min(1).max(1024),
  // META: the exact template name approved in Meta + language (default "id").
  metaName: z.string().min(1).max(120).optional(),
  metaLanguage: z.string().min(2).max(8).optional(),
});
export type MessageTemplate = z.infer<typeof messageTemplateSchema>;

export const templatesListSchema = z.array(messageTemplateSchema);

// Tenant.settings wrapper — only the keys we own are written; others merged.
const storedSettingsSchema = z.record(z.unknown());

function parseTemplates(raw: unknown): MessageTemplate[] {
  if (!raw) return [];
  const parsed = z.array(z.unknown()).safeParse(raw);
  if (!parsed.success) return [];
  const out: MessageTemplate[] = [];
  for (const item of parsed.data) {
    const t = messageTemplateSchema.safeParse(item);
    if (t.success) out.push(t.data);
  }
  return out;
}

export async function listTemplates(tenantId: string): Promise<MessageTemplate[]> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  if (!tenant) return [];
  const raw = z.record(z.unknown()).safeParse(tenant.settings ?? {});
  if (!raw.success) return [];
  return parseTemplates(raw.data.messageTemplates);
}

export async function saveTemplates(
  tenantId: string,
  templates: MessageTemplate[]
): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  if (!tenant) throw new Error("Tenant tidak ditemukan");
  const existing = storedSettingsSchema.safeParse(tenant.settings ?? {});
  const settings: Prisma.InputJsonValue = {
    ...(existing.success ? existing.data : {}),
    messageTemplates: templates,
  };
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { settings },
  });
}

// Resolve a template body by key, falling back to the provided default.
// Returns undefined for META templates without a metaName (caller decides).
export async function getTemplateBody(
  tenantId: string,
  key: string,
  fallback?: string
): Promise<string | undefined> {
  const templates = await listTemplates(tenantId);
  const t = templates.find((x) => x.key === key && x.kind === "CSQ");
  return t?.body ?? fallback;
}

// Resolve a META template (name + language) by key, e.g. for sends outside
// the 24h window. Returns undefined when not configured.
export async function getMetaTemplate(
  tenantId: string,
  key: string
): Promise<{ name: string; language: string } | undefined> {
  const templates = await listTemplates(tenantId);
  const t = templates.find((x) => x.key === key && x.kind === "META");
  if (!t?.metaName) return undefined;
  return { name: t.metaName, language: t.metaLanguage ?? "id" };
}

// System keys the platform recognizes (shown as hints in the UI).
export const SYSTEM_TEMPLATE_KEYS = [
  {
    key: "session_end",
    description:
      "Pesan penutup yang dikirim otomatis saat percakapan idle 1 jam (masih dalam window 24h, teks bebas).",
  },
  {
    key: "agent_fallback",
    description:
      "Pesan fallback saat AI mengalami gangguan (menggantikan default sistem).",
  },
  {
    key: "window_greeting",
    description:
      "Sapaan pembuka window baru (opsional; tanpa ini agent membalas tanpa sapaan khusus).",
  },
] as const;
