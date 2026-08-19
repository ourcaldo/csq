import makeWASocket, {
  useMultiFileAuthState as loadAuthState,
  DisconnectReason,
  type WASocket,
} from "@whiskeysockets/baileys";
import { pino } from "pino";
import path from "path";
import { z } from "zod";
import prisma from "@/lib/db";
import { ingestInboundMessage } from "@/lib/inbox";
import { processInboundWithAgent } from "@/lib/agent-loop";
import type { Channel } from "@prisma/client";
import type {
  BaileysConfig,
  ParsedInbound,
  SendTextInput,
  SendTextResult,
  WhatsAppProvider,
} from "@/types/whatsapp";

// Baileys bring-your-own-number provider (QR / pair-code login, full parity,
// no template/24h-window restriction). ToS/ban risk: the owner MUST acknowledge
// this at onboarding (FR-WA-011) — the channels API enforces tosAcknowledged
// before a Baileys channel can be enabled.
//
// Socket-driven: inbound arrives via `messages.upsert` events, not HTTP, so
// verifyWebhook/parseInbound are no-ops (the webhook route is Cloud-API-only).
// Auth state persists per channel on disk under ./.baileys-auth/<channelId> so
// the session survives restarts without re-scanning the QR.
//
// Server-only. Module-level singleton socket map — works under the Docker
// standalone Node deploy target (long-lived process).

const logger = pino({ level: "silent" });

type SocketEntry = { sock: WASocket; qr: string | null; open: boolean };
const sockets = new Map<string, SocketEntry>();

function authFolder(channelId: string): string {
  return path.join(process.cwd(), ".baileys-auth", channelId);
}

// Normalize a bare number to a WhatsApp JID.
function toJid(number: string): string {
  return number.includes("@") ? number : `${number}@s.whatsapp.net`;
}

// Bare number from a JID (strip @s.whatsapp.net / @lid).
function fromJid(jid: string | undefined | null): string {
  return (jid ?? "").split("@")[0];
}

// @hapi/boom error shape, parsed with Zod at the boundary (no `as` casts).
const boomSchema = z.object({
  output: z.object({ statusCode: z.number() }).optional(),
});
function disconnectCode(err: unknown): number | undefined {
  const parsed = boomSchema.safeParse(err);
  return parsed.success ? parsed.data?.output?.statusCode : undefined;
}

// Extract a text body from a Baileys message (text / extendedText / caption).
// Zod-parsed to avoid `as` casts on the untrusted message shape.
const messageBodySchema = z.object({
  conversation: z.string().optional(),
  extendedTextMessage: z.object({ text: z.string().optional() }).optional(),
});
function extractBody(message: unknown): string {
  const parsed = messageBodySchema.safeParse(message);
  if (!parsed.success) return "";
  return parsed.data.conversation ?? parsed.data.extendedTextMessage?.text ?? "";
}

// Start (or reattach) the socket for a Baileys channel. Returns the current QR
// string when login is pending, or null once connected. Called by the channels
// connect route and at boot for already-CONNECTED Baileys channels.
export async function connectBaileysChannel(
  channel: Channel
): Promise<{ qr: string | null; open: boolean }> {
  const existing = sockets.get(channel.id);
  if (existing && existing.open) {
    // Already connected.
    return { qr: null, open: true };
  }

  let entry: SocketEntry;
  if (existing) {
    // A socket already exists for this channel (e.g. login pending). Reuse it
    // instead of creating a duplicate — the QR arrives async via
    // connection.update and we wait for it below.
    entry = existing;
  } else {
    const { state, saveCreds } = await loadAuthState(authFolder(channel.id));
    const sock = makeWASocket({
      auth: state,
      logger,
      printQRInTerminal: false,
      connectTimeoutMs: 20_000,
    });

    entry = { sock, qr: null, open: false };
    sockets.set(channel.id, entry);

    sock.ev.on("connection.update", (update) => {
      if (update.qr) {
        entry.qr = update.qr;
      }
      if (update.connection === "open") {
        entry.open = true;
        entry.qr = null;
        void prisma.channel.update({
          where: { id: channel.id },
          data: { status: "CONNECTED" },
        });
      } else if (update.connection === "close") {
        const code = disconnectCode(update.lastDisconnect?.error);
        sockets.delete(channel.id);
        if (code !== DisconnectReason.loggedOut) {
          // Reconnect on transient close; reload the channel row for fresh state.
          void prisma.channel
            .findUnique({ where: { id: channel.id } })
            .then((fresh) => {
              if (fresh) void connectBaileysChannel(fresh);
            });
        } else {
          void prisma.channel.update({
            where: { id: channel.id },
            data: { status: "DISCONNECTED" },
          });
        }
      }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", (event) => {
      if (event.type !== "notify") return;
      for (const m of event.messages) {
        // Skip own outgoing messages.
        if (m.key.fromMe) continue;
        const body = extractBody(m.message);
        if (!body) continue;
        const from = fromJid(m.key.remoteJid);
        if (!from) continue;
        const tenantId = channel.tenantId;
        void (async () => {
          const recorded = await ingestInboundMessage({
            channelId: channel.id,
            tenantId,
            from,
            body,
            waMessageId: m.key.id ?? "",
            receivedAt: new Date(),
          });
          // Reload the channel so the agent loop sees fresh status/agentId.
          const fresh = await prisma.channel.findUnique({ where: { id: channel.id } });
          if (fresh) {
            void processInboundWithAgent({
              channel: fresh,
              conversationId: recorded.conversationId,
              customerPhone: from,
              body,
            });
          }
        })();
      }
    });
  }

  // The QR arrives asynchronously via connection.update; wait briefly so the
  // FIRST connect call returns it instead of null (which forced a second
  // click). Give up after 15s and return whatever we have.
  const deadline = Date.now() + 15_000;
  while (!entry.qr && !entry.open && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
  }
  return { qr: entry.qr, open: entry.open };
}

// At boot, reconnect every already-CONNECTED Baileys channel (session keys
// persist on disk, so no re-scan needed unless logged out). Called from the
// scheduler start.
export async function startBaileysChannels(): Promise<void> {
  const channels = await prisma.channel.findMany({
    where: { provider: "BAILEYS", status: "CONNECTED" },
  });
  for (const c of channels) {
    void connectBaileysChannel(c);
  }
}

// Stop and forget a channel's socket (used by disconnect).
export function disconnectBaileysChannel(channelId: string): void {
  const entry = sockets.get(channelId);
  if (entry) {
    try {
      entry.sock.end(undefined);
    } catch {
      // ignore
    }
    sockets.delete(channelId);
  }
}

export class BaileysProvider implements WhatsAppProvider {
  private readonly channelId: string;

  constructor(channelId: string, _config: BaileysConfig) {
    this.channelId = channelId;
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
    const entry = sockets.get(this.channelId);
    if (!entry || !entry.open) {
      throw new Error(
        `Baileys channel ${this.channelId} is not connected. Scan the QR via /api/dashboard/channels/connect first.`
      );
    }
    const sent = await entry.sock.sendMessage(toJid(input.to), { text: input.body });
    // Zod-parse the returned key.id (no `as` casts on the send result).
    const sentKeySchema = z.object({ key: z.object({ id: z.string() }).optional() });
    const parsed = sentKeySchema.safeParse(sent);
    return { waMessageId: parsed.success ? parsed.data.key?.id : undefined };
  }
}
