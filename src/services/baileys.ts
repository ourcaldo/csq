import makeWASocket, {
  DisconnectReason,
  getContentType,
  normalizeMessageContent,
  proto,
  type WASocket,
} from "@whiskeysockets/baileys";
import { pino } from "pino";
import { z } from "zod";
import prisma from "@/lib/db";
import { ingestInboundMessage } from "@/lib/inbox";
import { processInboundWithAgent } from "@/lib/agent-loop";
import { loadDbAuthState } from "@/lib/baileys-auth-db";
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
// Auth state persists per channel in the database (BaileysAuth table, see
// src/lib/baileys-auth-db.ts) so the session survives restarts without a
// persistent disk and without re-scanning the QR.
//
// Server-only. Module-level singleton socket map — works under the Docker
// standalone Node deploy target (long-lived process).

const logger = pino({ level: "silent" });

type SocketEntry = { sock: WASocket; qr: string | null; open: boolean };
const sockets = new Map<string, SocketEntry>();
// Channels the owner intentionally disconnected (Putuskan). The close
// handler checks this so it doesn't auto-reconnect on the end() —
// without this, disconnect bounces back to CONNECTED because the saved
// creds let the socket reopen.
const disconnecting = new Set<string>();

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
// Extract a text body from a Baileys message using Baileys' OWN utilities
// (normalizeMessageContent + getContentType), not a Zod schema. A Zod
// z.object().safeParse() on the raw protobufjs message object fails because
// the nested messageContextInfo carries Buffer values (messageSecret,
// recipientKeyHash) and the proto instance isn't a plain object Zod can
// parse — so the text in `conversation`/`extendedTextMessage.text` was
// silently dropped and every inbound was skipped as "empty body". Baileys'
// utilities handle the proto object and ephemeral/view-once wrapping
// correctly. No `as` casts — normalizeMessageContent returns any.
function extractBody(message: proto.IMessage | null | undefined): string {
  const content = normalizeMessageContent(message);
  if (!content) return "";
  // Typed property access on proto.IMessage — no string indexing, no `as`.
  // normalizeMessageContent already unwrapped ephemeral/view-once.
  if (typeof content.conversation === "string") return content.conversation;
  if (typeof content.extendedTextMessage?.text === "string") {
    return content.extendedTextMessage.text;
  }
  if (typeof content.imageMessage?.caption === "string") {
    return content.imageMessage.caption;
  }
  if (typeof content.videoMessage?.caption === "string") {
    return content.videoMessage.caption;
  }
  if (typeof content.documentMessage?.caption === "string") {
    return content.documentMessage.caption;
  }
  return "";
}

// Start (or reattach) the socket for a Baileys channel. Returns the current QR
// string when login is pending, or null once connected. Called by the channels
// connect route and at boot for already-CONNECTED Baileys channels.
export async function connectBaileysChannel(
  channel: Channel
): Promise<{ qr: string | null; open: boolean }> {
  const existing = sockets.get(channel.id);
  console.log(
    `[baileys:${channel.id}] connect requested; existing=${!!existing} open=${existing?.open ?? false} qr=${!!existing?.qr}`
  );
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
    const { state, saveCreds } = await loadDbAuthState(channel.id);
    const sock = makeWASocket({
      auth: state,
      logger,
      printQRInTerminal: false,
      connectTimeoutMs: 20_000,
      // Keep the WebSocket alive so host proxies (Render's load balancer)
      // don't terminate it as idle — this is what keeps the agent on 24/7
      // instead of dropping after a few minutes.
      keepAliveIntervalMs: 10_000,
      retryRequestDelayMs: 2_000,
    });

    entry = { sock, qr: null, open: false };
    sockets.set(channel.id, entry);

    sock.ev.on("connection.update", (update) => {
      console.log(
        `[baileys:${channel.id}] connection.update`,
        JSON.stringify({
          connection: update.connection,
          hasQr: !!update.qr,
          lastDisconnect: update.lastDisconnect?.error?.message,
        })
      );
      if (update.qr) {
        entry.qr = update.qr;
      }
      if (update.connection === "open") {
        entry.open = true;
        entry.qr = null;
        console.log(`[baileys:${channel.id}] OPEN — marking channel CONNECTED`);
        void prisma.channel
          .update({ where: { id: channel.id }, data: { status: "CONNECTED" } })
          .catch((err) =>
            console.error(`[baileys:${channel.id}] failed to mark CONNECTED:`, err)
          );
      } else if (update.connection === "close") {
        const code = disconnectCode(update.lastDisconnect?.error);
        console.log(`[baileys:${channel.id}] CLOSE code=${code}`);
        sockets.delete(channel.id);
        // Owner-initiated disconnect (Putuskan): don't reconnect.
        if (disconnecting.has(channel.id)) {
          disconnecting.delete(channel.id);
          return;
        }
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
      console.log(
        `[baileys:${channel.id}] messages.upsert type=${event.type} count=${event.messages?.length ?? 0}`
      );
      if (event.type !== "notify") return;
      for (const m of event.messages) {
        // Skip own outgoing messages.
        if (m.key.fromMe) {
          console.log(`[baileys:${channel.id}] skip own message`);
          continue;
        }
        const body = extractBody(m.message);
        console.log(
          `[baileys:${channel.id}] inbound from=${fromJid(m.key.remoteJid)} type=${getContentType(normalizeMessageContent(m.message)) ?? "?"} body=${JSON.stringify(body).slice(0, 80)}`
        );
        if (!body) {
          console.log(`[baileys:${channel.id}] skip empty body`);
          continue;
        }
        // Store the FULL remoteJid (e.g. "194274775822580@lid" or
        // "<phone>@s.whatsapp.net") — NOT the bare fromJid — so replies
        // route to the correct JID. Newer WhatsApp uses LIDs for 1:1 chats;
        // appending @s.whatsapp.net to a LID (as toJid would) sends to a
        // non-existent user and the reply is silently lost.
        const from = m.key.remoteJid ?? "";
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
            customerName: m.pushName || undefined,
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

// Read the live state of a Baileys channel's socket (current QR + open flag)
// without starting a new socket. Used by the GET /channels/[id]/qr route so
// the Saluran page can display the *current* QR (Baileys rotates it) and detect
// a completed scan. Returns { qr: null, open: false } when no socket is
// running (e.g. after a process restart) — the caller should re-connect.
export function getBaileysState(
  channelId: string
): { qr: string | null; open: boolean } {
  const entry = sockets.get(channelId);
  return { qr: entry?.qr ?? null, open: entry?.open ?? false };
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

// Heartbeat: a host proxy (e.g. Render's load balancer) can terminate the
// long-lived WebSocket to WhatsApp's servers minutes after it opens, and the
// raw close sometimes doesn't surface as a connection.update event — so the
// auto-reconnect in the close handler never fires and the socket stays dead
// (inbound messages silently drop). Poll every 45s: for each CONNECTED
// Baileys channel, reconnect if the socket entry is missing or stuck (not
// open, no pending QR). On the production VPS (direct connection) this is a
// harmless no-op once stable.
let heartbeat: ReturnType<typeof setInterval> | null = null;
export function startBaileysHeartbeat(): void {
  if (heartbeat) return;
  heartbeat = setInterval(async () => {
    const channels = await prisma.channel.findMany({
      where: { provider: "BAILEYS", status: "CONNECTED" },
    });
    for (const c of channels) {
      const entry = sockets.get(c.id);
      if (!entry || (!entry.open && !entry.qr)) {
        console.log(`[baileys:${c.id}] heartbeat: socket dead, reconnecting`);
        void connectBaileysChannel(c);
      }
    }
  }, 20_000);
}

// Stop and forget a channel's socket (used by disconnect).
export function disconnectBaileysChannel(channelId: string): void {
  disconnecting.add(channelId);
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
