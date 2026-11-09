import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
  type SignalDataSet,
} from "@whiskeysockets/baileys";
import prisma from "@csq/core/lib/db";

// Database-backed Baileys auth state - mirrors useMultiFileAuthState but
// stores the creds + keys in Postgres (BaileysAuth table) instead of the
// filesystem. This makes the WhatsApp session survive Render restarts
// without a persistent disk (PRD: always-on, no re-pair on restart).
//
// creds: a single object (serialized with BufferJSON.replacer so Buffers
// round-trip). keys: a flat map keyed by `${type}-${id}`, matching the
// per-file layout of useMultiFileAuthState. Server-only. No `as` casts -
// JSON.parse returns any, which assigns cleanly into the Baileys types.

// Resolve a WhatsApp LID (Linked Identity) JID to the real phone number.
// Returns the bare phone number (e.g. "62812xxxxxxx") for display and for
// outbound send routing, or null if no mapping is stored yet.
//
// lidJid is the full remoteJid, e.g. "194274775822580@lid" or
// "<user>:<device>@lid". The mapping is captured from key.senderPn on
// inbound messages (see storeLidPnMapping) - on Baileys 6.7.x there is no
// built-in LID store that persists (the lid-mapping-* signal keys are a
// v7-only mechanism, never written by 6.7.x).
export async function getPnForLid(
  channelId: string,
  lidJid: string
): Promise<string | null> {
  const userPart = lidJid.split("@")[0];
  const [lidUser] = userPart.split(":");
  if (!lidUser) return null;
  const row = await prisma.lidMapping.findUnique({
    where: { channelId_lid: { channelId, lid: lidUser } },
  });
  return row?.pn ?? null;
}

// In-memory change detection: an active chat fires one upsert per message,
// and the DB write should only happen when the mapping is new or changed.
const knownLidMappings = new Map<string, string>(); // key: `${channelId}:${lid}`

// Capture a LID -> phone-number mapping from an inbound message's
// key.senderPn (Baileys carries the sender's real number there even when the
// chat is LID-addressed). Sends to a raw "<lid>@lid" JID are accepted by
// WhatsApp but never delivered on Baileys 6.7.x (WhiskeySockets/Baileys#1950,
// #1964), so every outbound send must be re-routed to the real number.
export async function storeLidPnMapping(
  channelId: string,
  lidUser: string,
  pnUser: string
): Promise<void> {
  const key = `${channelId}:${lidUser}`;
  if (knownLidMappings.get(key) === pnUser) return;
  await prisma.lidMapping.upsert({
    where: { channelId_lid: { channelId, lid: lidUser } },
    create: { channelId, lid: lidUser, pn: pnUser },
    update: { pn: pnUser },
  });
  knownLidMappings.set(key, pnUser);
}

export async function loadDbAuthState(
  channelId: string
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const row = await prisma.baileysAuth.findUnique({ where: { channelId } });
  let creds: AuthenticationCreds = row?.creds
    ? JSON.parse(row.creds, BufferJSON.reviver)
    : initAuthCreds();
  // Flat key store: { "type-id": value }. JSON.parse -> any.
  let keysMap: Record<string, any> = row?.keys
    ? JSON.parse(row.keys, BufferJSON.reviver)
    : {};

  // One-time Signal session reset (2026-11-10). Deploy churn left the stored
  // Signal sessions stale: the linked device could not decrypt its own
  // account's messages ("Bad MAC" every few seconds) and recipients showed
  // "Menunggu pesan ini" for our sends. The marker row is set by migration
  // 20261110160000; consuming it here - at socket connect time, after the
  // previous instance is gone - removes the session records so fresh sessions
  // are negotiated on the next message exchange. Creds, pre-keys and
  // app-state keys stay intact: no QR re-scan.
  const resetMarker = await prisma.systemLock.findUnique({
    where: { key: "baileys-session-reset" },
  });
  if (resetMarker) {
    let removed = 0;
    for (const key of Object.keys(keysMap)) {
      if (key.startsWith("session-")) {
        delete keysMap[key];
        removed += 1;
      }
    }
    await prisma.baileysAuth.upsert({
      where: { channelId },
      create: {
        channelId,
        creds: JSON.stringify(creds, BufferJSON.replacer),
        keys: JSON.stringify(keysMap, BufferJSON.replacer),
      },
      update: {
        keys: JSON.stringify(keysMap, BufferJSON.replacer),
      },
    });
    await prisma.systemLock
      .delete({ where: { key: "baileys-session-reset" } })
      .catch(() => undefined);
    console.log(
      `[baileys-auth] reset ${removed} stale Signal session(s) for channel ${channelId}; sessions will re-negotiate`
    );
  }

  const persist = async (): Promise<void> => {
    await prisma.baileysAuth.upsert({
      where: { channelId },
      create: {
        channelId,
        creds: JSON.stringify(creds, BufferJSON.replacer),
        keys: JSON.stringify(keysMap, BufferJSON.replacer),
      },
      update: {
        creds: JSON.stringify(creds, BufferJSON.replacer),
        keys: JSON.stringify(keysMap, BufferJSON.replacer),
      },
    });
  };

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(
          type: T,
          ids: string[]
        ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
          const data: { [id: string]: SignalDataTypeMap[T] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = keysMap[`${type}-${id}`];
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value ?? null;
            })
          );
          return data;
        },
        set: async (data: SignalDataSet): Promise<void> => {
          for (const [category, entries] of Object.entries(data)) {
            if (!entries) continue;
            for (const [id, value] of Object.entries(entries)) {
              if (value) {
                keysMap[`${category}-${id}`] = value;
              } else {
                delete keysMap[`${category}-${id}`];
              }
            }
          }
          await persist();
        },
      },
    },
    saveCreds: () => persist(),
  };
}
