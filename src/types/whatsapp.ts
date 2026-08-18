import { z } from "zod";

// ─────────────────────────── Channel config ───────────────────────────
// Provider-specific bits of `Channel.config` (Prisma Json). The factory in
// src/lib/whatsapp-provider.ts parses these with Zod — no `as` narrowing.

// Cloud API (official). Tokens live server-side only; never leak to client.
// `verifyToken` + `appSecret` are only needed on the channel that receives
// webhooks; `token` + `phoneNumberId` are required to send.
export const cloudApiConfigSchema = z.object({
  phoneNumberId: z.string().min(1),
  token: z.string().min(1),
  verifyToken: z.string().min(1).optional(),
  appSecret: z.string().optional(),
  businessAccountId: z.string().optional(),
});
export type CloudApiConfig = z.infer<typeof cloudApiConfigSchema>;

// Baileys (bring your own number). Auth state persists per channel on disk
// (src/services/baileys.ts useMultiFileAuthState under .baileys-auth/<channelId>),
// so nothing secret is stored in `config`. `tosAcknowledged` is the ToS/ban-risk
// gate the channels API enforces before enabling a Baileys channel (FR-WA-011).
export const baileysConfigSchema = z.object({
  tosAcknowledged: z.boolean().optional(),
});
export type BaileysConfig = z.infer<typeof baileysConfigSchema>;

// ─────────────────────────── Webhook payload (Cloud API) ───────────────────────────
// Envelope: { object, entry:[{ id, changes:[{ field, value }] }] }. Inbound
// text messages and status updates share `value`. We validate shape only;
// untrusted content (message bodies) is stored verbatim and treated as
// prompt-injection surface downstream.

const metadataSchema = z.object({
  phone_number_id: z.string(),
  display_phone_number: z.string().optional(),
});

const contactSchema = z.object({
  wa_id: z.string(),
  profile: z.object({ name: z.string() }).optional(),
});

// `type` is a string (text/image/audio/...). Only `text` carries a body; other
// types are recorded as placeholders so the conversation stays traceable.
const messageSchema = z.object({
  type: z.string(),
  id: z.string(),
  from: z.string(),
  timestamp: z.string(),
  text: z.object({ body: z.string() }).optional(),
});

const statusSchema = z.object({
  id: z.string(),
  status: z.string(),
  recipient_id: z.string(),
  timestamp: z.string(),
});

const valueSchema = z.object({
  messaging_product: z.string().optional(),
  metadata: metadataSchema,
  contacts: z.array(contactSchema).optional(),
  messages: z.array(messageSchema).optional(),
  statuses: z.array(statusSchema).optional(),
});

const changeSchema = z.object({
  field: z.string(),
  value: valueSchema,
});

const entrySchema = z.object({
  id: z.string(),
  changes: z.array(changeSchema),
});

export const webhookPayloadSchema = z.object({
  object: z.string(),
  entry: z.array(entrySchema),
});
export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

// ─────────────────────────── Normalized inbound ───────────────────────────
// What the provider returns from parsing a webhook. channelId/tenantId are
// resolved by the webhook route AFTER locating the channel by phone_number_id,
// so the parsed form carries `phoneNumberId` instead.

export type ParsedInbound = {
  phoneNumberId: string;
  from: string;
  body: string;
  waMessageId: string;
  timestamp: Date;
  customerName?: string;
};

// Full inbound record used by the inbox ingest path (SDD §4.8 InboundMessage).
export type InboundMessage = {
  channelId: string;
  tenantId: string;
  from: string;
  body: string;
  waMessageId: string;
  receivedAt: Date;
  customerName?: string;
};

// ─────────────────────────── Outbound send ───────────────────────────

export const sendTextSchema = z.object({
  to: z.string().min(1),
  body: z.string().min(1).max(4096),
});
export type SendTextInput = z.infer<typeof sendTextSchema>;

export type SendTextResult = { waMessageId?: string };

// Meta's response to POST /messages: { messaging_product, contacts[], messages[{id}] }.
export const sendTextResponseSchema = z.object({
  messages: z.array(z.object({ id: z.string() })).min(1),
});

// ─────────────────────────── Provider interface ───────────────────────────
// Both Cloud API and Baileys implement this so the inbox/agent layer is
// provider-agnostic. The owner picks the provider at onboarding; the factory
// (src/lib/whatsapp-provider.ts) is the single switch point.
//
// Baileys has no public HTTP webhook (inbound arrives via socket events), so
// its `verifyWebhook` returns false and `parseInbound` returns [] — those are
// Cloud-API-only entry points. `sendText` is common to both.

export interface WhatsAppProvider {
  verifyWebhook(mode: string | undefined, verifyToken: string | undefined): boolean;
  parseInbound(payload: unknown): ParsedInbound[];
  sendText(input: SendTextInput): Promise<SendTextResult>;
}
