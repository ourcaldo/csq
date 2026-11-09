import { z } from "zod";

// ─────────────────────────── Channel config ───────────────────────────
// Provider-specific bits of `Channel.config` (Prisma Json). The factory in
// src/lib/whatsapp-provider.ts parses these with Zod - no `as` narrowing.

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

// Baileys (bring your own number). Auth state persists per channel in the
// database (BaileysAuth table, see src/lib/baileys-auth-db.ts), so nothing
// secret is stored in `config`. `tosAcknowledged` is the ToS/ban-risk gate the
// channels API enforces before enabling a Baileys channel (FR-WA-011).
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

// `type` is a string (text/image/audio/...). Only `text` carries a body;
// image/video/document may carry a `caption` (which IS text). Other types are
// recorded as placeholders so the conversation stays traceable, and are
// classified as MEDIA or OTHER so they never reach the LLM (D6).
export const messageSchema = z.object({
  type: z.string(),
  id: z.string(),
  from: z.string(),
  timestamp: z.string(),
  text: z.object({ body: z.string() }).optional(),
  image: z
    .object({
      caption: z.string().optional(),
      // The Meta media id + mime - present on inbound image messages; the
      // webhook downloads the bytes with it.
      id: z.string().optional(),
      mime_type: z.string().optional(),
    })
    .optional(),
  video: z.object({ caption: z.string().optional() }).optional(),
  document: z.object({ caption: z.string().optional() }).optional(),
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
//
// kind (D6): how the content arrived. TEXT = a real text body (including a
// media caption) and is the only kind that may trigger an agent turn.
// MEDIA = image/video/document/audio/sticker without a caption - stored for
// the inbox as "[image]" and answered by one debounced courtesy message.
// OTHER = reactions, unsupported types, system events - stored, no reply.

export type InboundKind = "text" | "media" | "other";

export type ParsedInbound = {
  phoneNumberId: string;
  from: string;
  body: string;
  kind: InboundKind;
  waMessageId: string;
  timestamp: Date;
  customerName?: string;
  // Present on inbound image messages: the Meta media id + mime. The webhook
  // downloads the bytes (downloadCloudMedia) and attaches them to the
  // InboundMessage before ingest, so the inbox can render the photo.
  media?: { externalId: string; mimeType: string };
};

// Full inbound record used by the inbox ingest path (SDD §4.8 InboundMessage).

export type InboundMessage = {
  channelId: string;
  tenantId: string;
  from: string;
  body: string;
  kind: InboundKind;
  waMessageId: string;
  receivedAt: Date;
  customerName?: string;
  // Inbound image bytes (downloaded by the provider/webhook layer). Ingest
  // stores them as a MediaAsset and links Message.mediaId so the inbox
  // renders the photo; without them a caption-less image falls back to the
  // "[image]" placeholder.
  media?: { bytes: Buffer; mimeType: string };
};

// ─────────────────────────── Outbound send ───────────────────────────

export const sendTextSchema = z.object({
  to: z.string().min(1),
  body: z.string().min(1).max(4096),
});
export type SendTextInput = z.infer<typeof sendTextSchema>;

export type SendTextResult = { waMessageId?: string };

// Image send (campaign bursts, feature plan 2026-11-01, section 3.2.1).
// Cloud API sends the public `link` (Meta fetches it, caching for ~10 min, so
// a blast reuses one fetch); Baileys needs the actual `bytes` in-process.
// The engine passes both, so neither provider hits the other's requirement.
export type SendImageInput = {
  to: string;
  link: string;
  bytes?: Buffer;
  mimeType?: string;
  // Optional caption shown under the image. Callers use it when a single
  // image carries the campaign text (one bubble instead of two).
  caption?: string;
};

// Meta's response to POST /messages: { messaging_product, contacts[], messages[{id}] }.
export const sendTextResponseSchema = z.object({
  messages: z.array(z.object({ id: z.string() })).min(1),
});

// ─────────────────────────── Template send (G7) ───────────────────────────
// Cloud API requires an approved template to message a customer outside the
// 24h customer-service window. Templates are pre-approved in the Meta Business
// Manager; their names are configured via env (WHATSAPP_APPROVAL_TEMPLATE, …).
// `components` is optional - simple body-only templates need none. Baileys
// has no 24h restriction, so its `sendTemplate` delegates to free-form text.
export const sendTemplateSchema = z.object({
  to: z.string().min(1),
  templateName: z.string().min(1),
  languageCode: z.string().min(1).max(8).optional(),
});
export type SendTemplateInput = z.infer<typeof sendTemplateSchema>;

// ─────────────────────────── Provider interface ───────────────────────────
// Both Cloud API and Baileys implement this so the inbox/agent layer is
// provider-agnostic. The owner picks the provider at onboarding; the factory
// (src/lib/whatsapp-provider.ts) is the single switch point.
//
// Baileys has no public HTTP webhook (inbound arrives via socket events), so
// its `parseInbound` returns [] - that is a Cloud-API-only entry point.
// `sendText` is common to both.

export interface WhatsAppProvider {
  parseInbound(payload: unknown): ParsedInbound[];
  sendText(input: SendTextInput): Promise<SendTextResult>;
  sendImage(input: SendImageInput): Promise<SendTextResult>;
  sendTemplate(input: SendTemplateInput): Promise<SendTextResult>;
}
