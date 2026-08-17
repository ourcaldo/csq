import type { Channel } from "@prisma/client";
import type { WhatsAppProvider } from "@/types/whatsapp";
import { baileysConfigSchema, cloudApiConfigSchema } from "@/types/whatsapp";
import { BaileysProvider } from "@/services/baileys";
import { CloudApiProvider } from "@/services/whatsapp";

// Single switch point between Cloud API and Baileys. Given a Channel record,
// parse its provider-specific `config` (Zod — no `as`) and return a provider
// instance bound to that config. Both providers implement the same interface,
// so callers (inbox, agent loop) stay provider-agnostic.
//
// Throws if the channel's config does not match its provider schema — a
// misconfigured channel should surface a clear error, not silently no-op.

export function getProvider(channel: Channel): WhatsAppProvider {
  if (channel.provider === "CLOUD_API") {
    const config = cloudApiConfigSchema.parse(channel.config);
    return new CloudApiProvider(config);
  }
  if (channel.provider === "BAILEYS") {
    const config = baileysConfigSchema.parse(channel.config);
    return new BaileysProvider(config);
  }
  throw new Error(`Unknown WhatsApp provider for channel ${channel.id}.`);
}
