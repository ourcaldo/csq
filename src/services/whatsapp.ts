import type {
  CloudApiConfig,
  ParsedInbound,
  SendTemplateInput,
  SendTextInput,
  SendTextResult,
  WhatsAppProvider,
} from "@/types/whatsapp";
import { sendTextResponseSchema, webhookPayloadSchema } from "@/types/whatsapp";

// WhatsApp Cloud API (official) provider — ToS-safe default.
// Graph API version is pinned (memory: v25.0); one service module per
// integration (CLAUDE.md). All fetch calls are server-side; the bearer token
// comes from Channel.config and never reaches the client bundle.

const GRAPH_API_VERSION = "v25.0";

// Parse a Cloud API webhook payload into normalized inbound messages.
// Exported standalone so the webhook route can parse without constructing a
// provider (parsing needs no secrets). Invalid payloads → [] (caller returns
// 200 to Meta regardless, per the 5s timeout contract).
export function parseCloudApiInbound(payload: unknown): ParsedInbound[] {
  const parsed = webhookPayloadSchema.safeParse(payload);
  if (!parsed.success) return [];
  const out: ParsedInbound[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const value = change.value;
      if (!value.messages) continue;
      const contacts = value.contacts ?? [];
      for (const msg of value.messages) {
        const contact = contacts.find((c) => c.wa_id === msg.from);
        out.push({
          phoneNumberId: value.metadata.phone_number_id,
          from: msg.from,
          body: msg.text?.body ?? `[${msg.type}]`,
          waMessageId: msg.id,
          timestamp: new Date(Number.parseInt(msg.timestamp, 10) * 1000),
          customerName: contact?.profile?.name,
        });
      }
    }
  }
  return out;
}

export class CloudApiProvider implements WhatsAppProvider {
  private readonly config: CloudApiConfig;

  constructor(config: CloudApiConfig) {
    this.config = config;
  }

  parseInbound(payload: unknown): ParsedInbound[] {
    return parseCloudApiInbound(payload);
  }

  // Outbound text. The caller (agent-outbox) enforces the 24h customer-service
  // window for free-form text; outside the window it must use sendTemplate.
  async sendText(input: SendTextInput): Promise<SendTextResult> {
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${this.config.phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "text",
        text: { preview_url: false, body: input.body },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // 429/rate-limit and other failures are logged by the caller; we do not
      // auto-retry (avoid spamming the customer).
      throw new Error(`WhatsApp Cloud API send failed (${res.status}): ${text}`);
    }
    const json: unknown = await res.json();
    const data = sendTextResponseSchema.parse(json);
    return { waMessageId: data.messages[0].id };
  }

  // Outbound template — required by Cloud API to reach a customer outside the
  // 24h customer-service window. The template must be pre-approved in Meta's
  // Business Manager; its name + language come from SendTemplateInput (caller
  // supplies env-configured names). Components are omitted (body-only templates).
  async sendTemplate(input: SendTemplateInput): Promise<SendTextResult> {
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${this.config.phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "template",
        template: {
          name: input.templateName,
          language: { code: input.languageCode ?? "id" },
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `WhatsApp Cloud API template send failed (${res.status}): ${text}`
      );
    }
    const json: unknown = await res.json();
    const data = sendTextResponseSchema.parse(json);
    return { waMessageId: data.messages[0].id };
  }
}
