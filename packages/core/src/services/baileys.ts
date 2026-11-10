import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  getContentType,
  normalizeMessageContent,
  proto,
  type WAVersion,
  type WASocket,
} from "@whiskeysockets/baileys";
import { pino } from "pino";
import { randomUUID } from "crypto";
import { z } from "zod";
import prisma from "@csq/core/lib/db";
import { withSystemContext } from "@csq/core/lib/tenant-context";
import { ingestInboundMessage } from "@csq/core/lib/inbox";
import { processInboundWithAgent } from "@csq/core/lib/agent-loop";
import { replyToNonText } from "@csq/core/lib/agent-outbox";
import { loadDbAuthState, getPnForLid, storeLidPnMapping } from "@csq/core/lib/baileys-auth-db";
import { acquireSystemLease, releaseSystemLease } from "@csq/core/lib/system-lock";
import type { Channel } from "@prisma/client";
import type {
  BaileysConfig,
  InboundKind,
  ParsedInbound,
  SendImageInput,
  SendTemplateInput,
  SendTextInput,
  SendTextResult,
  WhatsAppProvider,
} from "@csq/core/types/whatsapp";

// Baileys bring-your-own-number provider (QR / pair-code login, full parity,
// no template/24h-window restriction). ToS/ban risk: the owner MUST acknowledge
// this at onboarding (FR-WA-011) - the channels API enforces tosAcknowledged
// before a Baileys channel can be enabled.
//
// Socket-driven: inbound arrives via `messages.upsert` events, not HTTP, so
// verifyWebhook/parseInbound are no-ops (the webhook route is Cloud-API-only).
// Auth state persists per channel in the database (BaileysAuth table, see
// src/lib/baileys-auth-db.ts) so the session survives restarts without a
// persistent disk and without re-scanning the QR.
//
// Server-only. Module-level singleton socket map - works under the Docker
// standalone Node deploy target (long-lived process).

const logger = pino({ level: "silent" });

// WhatsApp 405-rejects handshakes that declare a stale WA Web version
// (client_too_old; WhiskeySockets/Baileys #2370, #2376 - our rc.9 deploy died
// exactly this way). The version shipped in the package rots between releases,
// so resolve the maintainers' current one once per process; when that fails
// (GitHub unreachable, layout changed) fall back to the package default.
let cachedWaVersion: WAVersion | null = null;
async function resolveWaVersion(): Promise<WAVersion | undefined> {
  if (cachedWaVersion) return cachedWaVersion;
  try {
    const { version } = await fetchLatestBaileysVersion({
      signal: AbortSignal.timeout(5_000),
    });
    cachedWaVersion = version;
    console.log(`[baileys] WA version ${version.join(".")} (upstream)`);
    return version;
  } catch {
    console.log("[baileys] WA version fetch failed - using package default");
    return undefined;
  }
}

// This process's identity as a WhatsApp-session lease owner. WhatsApp allows
// ONE connection per session: when two service instances (a deploy overlap, a
// replacing instance kept draining by open SSE streams) each hold a socket,
// they 440-conflict-loop and every send is lost. Only the lease holder below
// may connect; peers stand down until the holder's process dies and its lease
// expires.
const instanceToken = randomUUID();
const SOCKET_LEASE_TTL_SECONDS = 45; // heartbeat renews every 20s

function leaseKey(channelId: string): string {
  return `baileys-socket:${channelId}`;
}

type SocketEntry = {
  sock: WASocket;
  qr: string | null;
  open: boolean;
  // Close code from the last connection.update close, surfaced to the connect
  // route so it can tell the owner WHY the QR never appeared.
  closeCode: number | null;
  // Owner-initiated disconnect (Putuskan): this socket's close event must not
  // auto-reconnect. Per-socket flag, so a logout can never suppress the
  // reconnect of a later session (a channel-level Set went stale and did).
  intentional: boolean;
};
const sockets = new Map<string, SocketEntry>();

// Normalize a bare number to a WhatsApp JID. JIDs pass through unchanged.
// Indonesian owners type numbers in local form ("0812...", "812...", "+62 812...")
// - appending the domain raw makes "0812...@s.whatsapp.net", a non-existent
// user WhatsApp accepts silently and never delivers (no echo, no error).
// PRD market is Indonesian, so: strip non-digits, "0..." -> "62...", bare
// "8xxxxxxxxxx" (9-12 digits, an Indonesian mobile without prefix) -> "62...".
// Exported for the JID self-check (scripts/self-check-baileys-jid.ts).
export function toJid(number: string): string {
  if (number.includes("@")) return number;
  const digits = number.replace(/\D/g, "");
  let normalized = digits;
  if (normalized.startsWith("0")) {
    normalized = `62${normalized.slice(1)}`;
  } else if (/^8\d{8,11}$/.test(normalized)) {
    normalized = `62${normalized}`;
  }
  return `${normalized}@s.whatsapp.net`;
}

// Canonical conversation identity for an inbound Baileys chat (one thread per
// customer, owner request 2026-11-10):
// - a "@s.whatsapp.net" JID -> bare phone digits (the same form the Cloud API
//   stores, so the two channels share ONE thread);
// - a "@lid" JID -> the real phone digits from key.remoteJidAlt (Baileys 7
//   carries the PN JID there; 6.x called it senderPn), else the raw LID JID
//   (last resort; sends still resolve via the LID mapping).
export function canonicalIdentity(
  remoteJid: string,
  altJid: string | null | undefined
): string {
  const bare = (jid: string): string => jid.split("@")[0].split(":")[0];
  if (remoteJid.endsWith("@lid")) {
    return altJid ? bare(altJid) : remoteJid;
  }
  if (remoteJid.endsWith("@s.whatsapp.net")) return bare(remoteJid);
  return remoteJid;
}

// Bare number from a JID (strip @s.whatsapp.net / @lid).
function fromJid(jid: string | undefined | null): string {
  return (jid ?? "").split("@")[0];
}

// @hapi/boom error shape, parsed with Zod at the boundary (no `as` casts).
const boomSchema = z.object({
  output: z.object({ statusCode: z.number() }).optional(),
});
// Exported for the close-handling self-check (scripts/self-check-baileys-close.ts).
export function disconnectCode(err: unknown): number | undefined {
  const parsed = boomSchema.safeParse(err);
  return parsed.success ? parsed.data?.output?.statusCode : undefined;
}

// Fatal closes mean the WhatsApp session is dead server-side (device
// unlinked, corrupt creds, account blocked). Reconnecting is pointless, and
// resuming with the saved creds can never produce a QR - the close handler
// clears creds so the next connect starts a fresh QR pairing. 440
// (connectionReplaced) is NOT fatal and is handled separately in the close
// handler: another connection took over, the creds may still be valid, so we
// stand down without touching them. Everything else (timedOut,
// connectionClosed, connectionLost, restartRequired, ...) is transient:
// auto-reconnect keeps the agent on 24/7.
export function isFatalDisconnect(code: number | null | undefined): boolean {
  return (
    code === DisconnectReason.loggedOut || // 401: device unlinked / logged out
    code === DisconnectReason.badSession || // 500: corrupt session
    code === DisconnectReason.forbidden // 403: account blocked
  );
}

// Extract the inbound content from a Baileys message: a display body plus the
// D6 kind. Text (including a media caption) is "text"; media without a
// caption is "media"; anything else is "other", which the caller skips (nothing
// to store). Inbound IMAGES also carry their Baileys metadata (mime + size) so
// the handler can download the bytes and the inbox can render the photo - a
// captioned photo stays kind "text" (the caption still drives the agent turn)
// but now keeps its image too.
// Uses Baileys' OWN utilities (normalizeMessageContent + getContentType), not
// a Zod schema. A Zod z.object().safeParse() on the raw protobufjs message
// object fails because the nested messageContextInfo carries Buffer values
// (messageSecret, recipientKeyHash) and the proto instance isn't a plain
// object Zod can parse - so the text in `conversation`/`extendedTextMessage.text`
// was silently dropped and every inbound was skipped as "empty body". Baileys'
// utilities handle the proto object and ephemeral/view-once wrapping
// correctly. No `as` casts - normalizeMessageContent returns any.
function extractContent(
  message: proto.IMessage | null | undefined
): {
  body: string;
  kind: InboundKind;
  image?: { mimeType: string; fileLength: number };
} {
  const content = normalizeMessageContent(message);
  if (!content) return { body: "", kind: "other" };
  // Typed property access on proto.IMessage - no string indexing, no `as`.
  // normalizeMessageContent already unwrapped ephemeral/view-once.
  if (typeof content.conversation === "string") {
    return { body: content.conversation, kind: "text" };
  }
  if (typeof content.extendedTextMessage?.text === "string") {
    return { body: content.extendedTextMessage.text, kind: "text" };
  }
  if (content.imageMessage) {
    const caption = content.imageMessage.caption;
    const fileLength = Number(content.imageMessage.fileLength ?? 0);
    return {
      body: typeof caption === "string" ? caption : "",
      kind: typeof caption === "string" && caption.length > 0 ? "text" : "media",
      image: {
        mimeType: content.imageMessage.mimetype ?? "image/jpeg",
        fileLength,
      },
    };
  }
  const caption =
    content.videoMessage?.caption ?? content.documentMessage?.caption;
  if (typeof caption === "string" && caption.length > 0) {
    return { body: caption, kind: "text" };
  }
  if (content.videoMessage) return { body: "[video]", kind: "media" };
  if (content.documentMessage) return { body: "[document]", kind: "media" };
  if (content.audioMessage) return { body: "[audio]", kind: "media" };
  if (content.stickerMessage) return { body: "[sticker]", kind: "media" };
  return { body: "", kind: "other" };
}

// Start (or reattach) the socket for a Baileys channel. Returns the current QR
// string when login is pending, or null once connected. Called by the channels
// connect route and at boot for already-CONNECTED Baileys channels.
// stealLease: set by the connect route (the owner's explicit action) to take
// the session over from a peer instance that is still draining.
export async function connectBaileysChannel(
  channel: Channel,
  opts?: { stealLease?: boolean }
): Promise<{ qr: string | null; open: boolean; closeCode: number | null }> {
  // Bypass context (PRD 16 SEC-1): the socket runtime owns Channel and
  // BaileysAuth rows across tenants, and the socket's event callbacks capture
  // this context at registration time - so cred saves and status writes made
  // later from connection.update/messages.upsert handlers stay covered.
  // Inbound message handling re-enters the tenant context inside
  // ingestInboundMessage/processInboundWithAgent.
  return withSystemContext(() => connectBaileysChannelInner(channel, opts));
}

async function connectBaileysChannelInner(
  channel: Channel,
  opts?: { stealLease?: boolean }
): Promise<{ qr: string | null; open: boolean; closeCode: number | null }> {
  // Only one instance may hold the WhatsApp session. A failed acquire means
  // another live instance owns it - connecting a duplicate would 440-conflict
  // and kill both sockets.
  const owns = await acquireSystemLease(
    leaseKey(channel.id),
    instanceToken,
    SOCKET_LEASE_TTL_SECONDS,
    opts?.stealLease ?? false
  );
  if (!owns) {
    console.log(
      `[baileys:${channel.id}] another instance holds the WhatsApp session - standing down`
    );
    return { qr: null, open: false, closeCode: null };
  }
  const existing = sockets.get(channel.id);
  console.log(
    `[baileys:${channel.id}] connect requested; existing=${!!existing} open=${existing?.open ?? false} qr=${!!existing?.qr}`
  );
  if (existing && existing.open) {
    // Already connected.
    return { qr: null, open: true, closeCode: null };
  }

  let entry: SocketEntry;
  if (existing) {
    // A socket already exists for this channel (e.g. login pending). Reuse it
    // instead of creating a duplicate - the QR arrives async via
    // connection.update and we wait for it below.
    entry = existing;
  } else {
    const { state, saveCreds } = await loadDbAuthState(channel.id);
    // Re-check after the await: a concurrent connect (heartbeat racing the
    // close-handler reconnect) may have registered while we loaded creds -
    // report it instead of creating a second socket with the same session
    // (WhatsApp kills one of the two with 440).
    const raced = sockets.get(channel.id);
    if (raced) {
      return { qr: raced.qr, open: raced.open, closeCode: raced.closeCode };
    }
    const sock = makeWASocket({
      auth: state,
      logger,
      printQRInTerminal: false,
      connectTimeoutMs: 20_000,
      version: await resolveWaVersion(),
      // Keep the WebSocket alive so host proxies (Render's load balancer)
      // don't terminate it as idle - this is what keeps the agent on 24/7
      // instead of dropping after a few minutes.
      keepAliveIntervalMs: 10_000,
      retryRequestDelayMs: 2_000,
    });

    entry = { sock, qr: null, open: false, closeCode: null, intentional: false };
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
        console.log(`[baileys:${channel.id}] OPEN - marking channel CONNECTED`);
        void prisma.channel
          .update({ where: { id: channel.id }, data: { status: "CONNECTED" } })
          .catch((err) =>
            console.error(`[baileys:${channel.id}] failed to mark CONNECTED:`, err)
          );
      } else if (update.connection === "close") {
        const code = disconnectCode(update.lastDisconnect?.error);
        console.log(`[baileys:${channel.id}] CLOSE code=${code}`);
        entry.closeCode = code ?? null;
        // Remove the registry entry only if it still belongs to THIS socket.
        // A close event can arrive after a successor socket already
        // registered (heartbeat reconnect, deploy overlap) - deleting the
        // successor made the heartbeat see a live channel as dead, connect a
        // duplicate session, and 440-conflict-loop forever.
        if (sockets.get(channel.id) === entry) {
          sockets.delete(channel.id);
        }
        // Owner-initiated disconnect (Putuskan): don't reconnect or rewrite
        // status - the disconnect API owns both.
        if (entry.intentional) return;
        if (code === DisconnectReason.connectionReplaced) {
          // 440: another connection took over the session (deploy overlap, or
          // a re-link elsewhere). The creds may still be valid for our own
          // successor, so keep them and leave the row alone - stand down and
          // let the survivor, the heartbeat, or the owner reconcile.
          console.log(
            `[baileys:${channel.id}] connection replaced - standing down`
          );
          return;
        }
        if (isFatalDisconnect(code)) {
          // Session is dead server-side. Mark the row so the dashboard stops
          // claiming "Terhubung", and destroy the saved creds - they can never
          // resume, and as long as they exist Baileys retries the dead session
          // instead of showing a fresh QR.
          console.log(
            `[baileys:${channel.id}] session dead (code=${code}) - marking DISCONNECTED, clearing creds`
          );
          prisma.channel
            .update({
              where: { id: channel.id },
              data: { status: "DISCONNECTED" },
            })
            .catch((err: unknown) =>
              console.error(
                `[baileys:${channel.id}] failed to mark DISCONNECTED:`,
                err
              )
            );
          prisma.baileysAuth
            .delete({ where: { channelId: channel.id } })
            .catch((err: unknown) =>
              console.error(
                `[baileys:${channel.id}] creds cleanup failed:`,
                err
              )
            );
          // The session is gone - give up the lease so a peer (or this
          // instance's next user-initiated connect) can take over cleanly.
          void releaseSystemLease(leaseKey(channel.id), instanceToken).catch(
            (err: unknown) =>
              console.error(`[baileys:${channel.id}] lease release failed:`, err)
          );
        } else {
          // Reconnect on transient close; reload the channel row for fresh state.
          prisma.channel
            .findUnique({ where: { id: channel.id } })
            .then((fresh) => {
              if (fresh) void connectBaileysChannel(fresh);
            })
            .catch((err: unknown) =>
              console.error(`[baileys:${channel.id}] reconnect failed:`, err)
            );
        }
      }
    });

    sock.ev.on("creds.update", saveCreds);

    // Real delivery failures surface here, ASYNC, after sendMessage already
    // resolved: WhatsApp rejects a send with status ERROR and a stub reason
    // (e.g. "463") in messages.update (WhiskeySockets/Baileys#2653). Without
    // this listener a silently undelivered send is indistinguishable from a
    // delivered one.
    sock.ev.on("messages.update", (updates) => {
      for (const u of updates) {
        const stubs = u.update?.messageStubParameters;
        if (
          u.update?.status === proto.WebMessageInfo.Status.ERROR ||
          (stubs && stubs.length > 0)
        ) {
          console.log(
            `[baileys:${channel.id}] delivery failure id=${u.key.id} to=${u.key.remoteJid} status=${u.update?.status} stubs=${JSON.stringify(stubs ?? [])}`
          );
        }
      }
    });

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
        // Skip group/broadcast/newsletter messages - the CS agent handles
        // 1:1 customer chats only, not groups the number joined.
        const jid = m.key.remoteJid ?? "";
        if (
          jid.endsWith("@g.us") ||
          jid.endsWith("@broadcast") ||
          jid.endsWith("@newsletter")
        ) {
          continue;
        }
        const content = extractContent(m.message);
        const body = content.body;
        const kind = content.kind;
        console.log(
          `[baileys:${channel.id}] inbound from=${fromJid(m.key.remoteJid)} type=${getContentType(normalizeMessageContent(m.message)) ?? "?"} kind=${kind} body=${JSON.stringify(body).slice(0, 80)}`
        );
        // Skip only truly empty payloads. Images with no caption have an
        // empty body but still carry a photo worth storing/rendering.
        if (kind === "other" || (!body && !content.image)) {
          console.log(`[baileys:${channel.id}] skip empty body`);
          continue;
        }
        // Store the FULL remoteJid for the LID mapping and reply routing; the
        // CONVERSATION identity is the canonical form (bare phone digits when
        // known) so one person never splits into a LID thread and a phone
        // thread.
        const remoteJid = m.key.remoteJid ?? "";
        if (!remoteJid) continue;
        // Baileys 7 carries the alternative JID (the PN when the chat is
        // LID-addressed) on the message key. Capture the LID -> phone-number
        // mapping from it; kept for legacy LID-keyed conversations and the
        // provider's send re-route.
        const altJid = m.key.remoteJidAlt ?? m.key.participantAlt ?? null;
        if (remoteJid.endsWith("@lid") && altJid) {
          const lidUser = remoteJid.split("@")[0].split(":")[0];
          const pnUser = altJid.split("@")[0].split(":")[0];
          if (lidUser && pnUser) {
            void storeLidPnMapping(channel.id, lidUser, pnUser).catch(
              (err: unknown) =>
                console.error(
                  `[baileys:${channel.id}] lid-mapping store failed:`,
                  err
                )
            );
          }
        }
        const from = canonicalIdentity(remoteJid, altJid);
        const tenantId = channel.tenantId;
        void (async () => {
          // Inbound image: download the bytes (bounded - 10 MB cap, best
          // effort; on failure the message still ingests with the
          // "[image]" placeholder) so the inbox renders the photo.
          let media: { bytes: Buffer; mimeType: string } | undefined;
          if (content.image) {
            const maxBytes = 10 * 1024 * 1024;
            if (content.image.fileLength > maxBytes) {
              console.log(
                `[baileys:${channel.id}] inbound image over 10 MB - stored as placeholder`
              );
            } else {
              try {
                const bytes = await downloadMediaMessage(m, "buffer", {});
                if (bytes && bytes.length > 0 && bytes.length <= maxBytes) {
                  media = { bytes, mimeType: content.image.mimeType };
                }
              } catch (err) {
                console.error(
                  `[baileys:${channel.id}] inbound image download failed:`,
                  err
                );
              }
            }
          }
          const recorded = await ingestInboundMessage({
            channelId: channel.id,
            tenantId,
            from,
            body,
            kind,
            waMessageId: m.key.id ?? "",
            receivedAt: new Date(),
            customerName: m.pushName || undefined,
            ...(media ? { media } : {}),
          });
          // Redelivery of a waMessageId we already stored: no second turn.
          if (recorded.duplicate) return;
          // Reload the channel so the agent loop sees fresh status/agentId.
          const fresh = await prisma.channel.findUnique({ where: { id: channel.id } });
          if (!fresh) return;
          // D6: only real text drives the LLM; media gets one debounced reply.
          if (kind === "text") {
            void processInboundWithAgent({
              channel: fresh,
              conversationId: recorded.conversationId,
            });
          } else if (kind === "media") {
            void replyToNonText({
              channel: fresh,
              conversationId: recorded.conversationId,
            }).catch((err: unknown) => {
              console.error(
                `[baileys:${channel.id}] non-text reply failed for ${m.key.id ?? ""}:`,
                err
              );
            });
          }
        })().catch((err: unknown) => {
          console.error(
            `[baileys:${channel.id}] ingest failed for ${m.key.id ?? ""}:`,
            err
          );
        });
      }
    });
  }

  // The QR arrives asynchronously via connection.update; wait briefly so the
  // FIRST connect call returns it instead of null (which forced a second
  // click). Give up after 15s and return whatever we have. If the socket died
  // while waiting (the close handler removes it from the map), stop early -
  // polling a dead entry for the full 15s just delayed the caller's error.
  const deadline = Date.now() + 15_000;
  while (!entry.qr && !entry.open && Date.now() < deadline) {
    if (sockets.get(channel.id) !== entry) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  return { qr: entry.qr, open: entry.open, closeCode: entry.closeCode };
}

// Read the live state of a Baileys channel's socket (current QR + open flag)
// without starting a new socket. Used by the GET /channels/[id]/qr route so
// the Saluran page can display the *current* QR (Baileys rotates it) and detect
// a completed scan. Returns { qr: null, open: false } when no socket is
// running (e.g. after a process restart) - the caller should re-connect.
export function getBaileysState(
  channelId: string
): { qr: string | null; open: boolean } {
  const entry = sockets.get(channelId);
  return { qr: entry?.qr ?? null, open: entry?.open ?? false };
}

// Live socket check for cross-process send routing (Phase 7): the worker is
// the only process where this returns true.
export function hasBaileysSocket(channelId: string): boolean {
  const entry = sockets.get(channelId);
  return !!entry && entry.open;
}

// At boot, reconnect every already-CONNECTED Baileys channel (session keys
// persist in the BaileysAuth table, so no re-scan unless logged out). Called
// from the scheduler start.
export async function startBaileysChannels(): Promise<void> {
  // Cross-tenant boot scan: bypass context (PRD 16 SEC-1). connectBaileysChannel
  // enters its own context.
  const channels = await withSystemContext(async () =>
    prisma.channel.findMany({
      where: { provider: "BAILEYS", status: "CONNECTED" },
    })
  );
  for (const c of channels) {
    void connectBaileysChannel(c).catch((err: unknown) =>
      console.error(`[baileys:${c.id}] boot reconnect failed:`, err)
    );
  }
}

// Heartbeat: a host proxy (e.g. Render's load balancer) can terminate the
// long-lived WebSocket to WhatsApp's servers minutes after it opens, and the
// raw close sometimes doesn't surface as a connection.update event - so the
// auto-reconnect in the close handler never fires and the socket stays dead
// (inbound messages silently drop). Poll every 20s: for each CONNECTED
// Baileys channel, reconnect if the socket entry is missing or stuck (not
// open, no pending QR). On the production VPS (direct connection) this is a
// harmless no-op once stable.
let heartbeat: ReturnType<typeof setInterval> | null = null;
export function startBaileysHeartbeat(): void {
  if (heartbeat) return;
  heartbeat = setInterval(async () => {
    const channels = await withSystemContext(async () =>
      prisma.channel.findMany({
        where: { provider: "BAILEYS", status: "CONNECTED" },
      })
    );
    for (const c of channels) {
      // Renew the session lease; a non-holder stands down entirely (its peer
      // instance owns the socket - reconnecting would 440-conflict both).
      const owns = await acquireSystemLease(
        leaseKey(c.id),
        instanceToken,
        SOCKET_LEASE_TTL_SECONDS
      );
      if (!owns) {
        console.log(
          `[baileys:${c.id}] another instance holds the WhatsApp session - standing down`
        );
        continue;
      }
      const entry = sockets.get(c.id);
      if (!entry || (!entry.open && !entry.qr)) {
        console.log(`[baileys:${c.id}] heartbeat: socket dead, reconnecting`);
        void connectBaileysChannel(c).catch((err: unknown) =>
          console.error(`[baileys:${c.id}] heartbeat reconnect failed:`, err)
        );
      }
    }
  }, 20_000);
}

// Stop and forget a channel's socket (used by disconnect).
// Disconnect (Putuskan): logs out the linked device on WhatsApp's side
// (sock.logout() - the paired device is auto-removed from the owner's
// phone), tears down the socket, and deletes the saved creds so reconnect
// requires a fresh QR. This is a FULL disconnect, not just pausing the
// socket.
export async function disconnectBaileysChannel(channelId: string): Promise<void> {
  const entry = sockets.get(channelId);
  if (entry) {
    // Flag THIS socket so its close event doesn't trigger auto-reconnect.
    entry.intentional = true;
    try {
      await entry.sock.logout();
    } catch {
      // ignore - socket may already be closed
    }
    sockets.delete(channelId);
  }
  // Destroy the saved creds so reconnect requires a fresh QR scan.
  await withSystemContext(async () => {
    await prisma.baileysAuth.delete({ where: { channelId } }).catch(() => undefined);
  });
  // Owner ended the session - release the lease immediately.
  await releaseSystemLease(leaseKey(channelId), instanceToken).catch(() => undefined);
}

// Graceful worker shutdown (SIGTERM: a deploy is replacing this process).
// Ends every socket WITHOUT logout - the saved creds stay valid, so the next
// worker reconnects without a QR re-scan. `intentional` keeps each socket's
// close handler from auto-reconnecting or rewriting channel status while the
// process exits.
export async function shutdownBaileysChannels(): Promise<void> {
  for (const [channelId, entry] of sockets) {
    entry.intentional = true;
    try {
      entry.sock.end(new Error("worker shutdown"));
    } catch {
      // socket may already be closed
    }
    sockets.delete(channelId);
  }
}

// Pure send-destination rewrite (self-check covered): a "<lid>@lid"
// destination is rewritten to the real phone number when the mapping is
// known. Phone-JID sends are the proven delivery path; raw LID sends are
// accepted by WhatsApp but never delivered on Baileys 6.7.x
// (WhiskeySockets/Baileys#1950, #1964).
export function resolveSendJid(jid: string, pn: string | null): string {
  return jid.endsWith("@lid") && pn ? `${pn}@s.whatsapp.net` : jid;
}

export class BaileysProvider implements WhatsAppProvider {
  private readonly channelId: string;

  constructor(channelId: string, _config: BaileysConfig) {
    this.channelId = channelId;
  }

  // Resolve the send destination: a LID JID is rewritten to the sender's
  // real phone number when we captured the mapping from an inbound
  // (key.senderPn). Without a mapping the raw LID is kept - last resort,
  // WhatsApp drops it silently.
  private async destination(to: string): Promise<string> {
    const jid = toJid(to);
    if (!jid.endsWith("@lid")) return jid;
    const pn = await getPnForLid(this.channelId, jid).catch(() => null);
    const resolved = resolveSendJid(jid, pn);
    if (resolved !== jid) {
      console.log(
        `[baileys:${this.channelId}] lid ${jid} -> pn ${resolved}`
      );
    }
    return resolved;
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
    // Log the resolved JID: a send to a non-existent user is silently dropped
    // by WhatsApp (no echo, no error) - the destination is the only clue.
    const jid = await this.destination(input.to);
    console.log(`[baileys:${this.channelId}] sendText to=${jid}`);
    const sent = await entry.sock.sendMessage(jid, { text: input.body });
    // Zod-parse the returned key.id (no `as` casts on the send result).
    const sentKeySchema = z.object({ key: z.object({ id: z.string() }).optional() });
    const parsed = sentKeySchema.safeParse(sent);
    return { waMessageId: parsed.success ? parsed.data.key?.id : undefined };
  }

  // Image send for campaign bursts: Baileys sends the bytes in-process (no
  // window restriction on this provider).
  async sendImage(input: SendImageInput): Promise<SendTextResult> {
    const entry = sockets.get(this.channelId);
    if (!entry || !entry.open) {
      throw new Error(
        `Baileys channel ${this.channelId} is not connected. Scan the QR via /api/dashboard/channels/connect first.`
      );
    }
    if (!input.bytes) {
      throw new Error("Baileys image send requires the image bytes.");
    }
    const jid = await this.destination(input.to);
    console.log(`[baileys:${this.channelId}] sendImage to=${jid}`);
    const sent = await entry.sock.sendMessage(jid, {
      image: input.bytes,
      mimetype: input.mimeType,
      ...(input.caption ? { caption: input.caption } : {}),
    });
    const sentKeySchema = z.object({ key: z.object({ id: z.string() }).optional() });
    const parsed = sentKeySchema.safeParse(sent);
    return { waMessageId: parsed.success ? parsed.data.key?.id : undefined };
  }

  // Baileys has no 24h/template restriction, so a "template" send is just a
  // free-form text message using the template name as the body. This keeps the
  // agent-outbox path provider-agnostic: callers can always call sendTemplate
  // without a Cloud-API-specific approved template existing.
  async sendTemplate(input: SendTemplateInput): Promise<SendTextResult> {
    return this.sendText({ to: input.to, body: input.templateName });
  }
}
