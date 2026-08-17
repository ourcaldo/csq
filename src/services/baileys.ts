import type {
  BaileysConfig,
  ParsedInbound,
  SendTextInput,
  SendTextResult,
  WhatsAppProvider,
} from "@/types/whatsapp";

// Baileys bring-your-own-number provider (QR / pair-code login, full parity,
// no template/24h-window restriction). ToS/ban risk: the owner MUST
// acknowledge this at onboarding (FR-WA-011). The warning UI is the
// dashboard's job (Phase 8); this module only exposes `tosAcknowledged` via
// the channel config for the integrator to gate on.
//
// This is a provider STUB: it implements the SAME WhatsAppProvider interface
// so the owner can switch providers at onboarding without touching the
// inbox/agent layer. Full socket wiring requires `@whiskeysockets/baileys`
// (pure, no Puppeteer — light RAM), which is NOT in package.json for the MVP.
// When the integrator adds the dependency, fill the TODOs below:
//   - module-level singleton socket map keyed by channelId
//   - QR / pair-code auth, session keys persisted to Postgres (this.config.sessionKeys)
//   - socket "messages.upsert" events → normalized ParsedInbound → inbox ingest
//   - reconnect/re-auth from stored keys on disconnect
// Inbound for Baileys arrives via socket events, NOT HTTP, so verifyWebhook
// and parseInbound are no-ops here (the webhook route is Cloud-API-only).

export class BaileysProvider implements WhatsAppProvider {
  private readonly config: BaileysConfig;

  constructor(config: BaileysConfig) {
    this.config = config;
  }

  // Baileys has no public HTTP webhook to verify.
  verifyWebhook(_mode: string | undefined, _verifyToken: string | undefined): boolean {
    return false;
  }

  // Inbound is socket-driven, not HTTP; the webhook path is never used.
  parseInbound(_payload: unknown): ParsedInbound[] {
    return [];
  }

  async sendText(input: SendTextInput): Promise<SendTextResult> {
    // TODO(baileys): use makeWASocket from @whiskeysockets/baileys to send.
    // Socket is a module-level singleton keyed by channel; auth keys persist
    // in this.config.sessionKeys. Full parity, no 24h window.
    const hasKeys = Boolean(this.config.sessionKeys);
    throw new Error(
      `Baileys provider not yet wired (to=${input.to}, sessionKeysPresent=${hasKeys}). ` +
        "Install @whiskeysockets/baileys and complete sendText."
    );
  }
}
