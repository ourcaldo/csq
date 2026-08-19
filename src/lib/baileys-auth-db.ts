import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
  type SignalDataSet,
} from "@whiskeysockets/baileys";
import prisma from "@/lib/db";

// Database-backed Baileys auth state — mirrors useMultiFileAuthState but
// stores the creds + keys in Postgres (BaileysAuth table) instead of the
// filesystem. This makes the WhatsApp session survive Render restarts
// without a persistent disk (PRD: always-on, no re-pair on restart).
//
// creds: a single object (serialized with BufferJSON.replacer so Buffers
// round-trip). keys: a flat map keyed by `${type}-${id}`, matching the
// per-file layout of useMultiFileAuthState. Server-only. No `as` casts —
// JSON.parse returns any, which assigns cleanly into the Baileys types.

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
