import prisma from "@csq/core/lib/db";
import type { ChannelCommand } from "@prisma/client";
import { withSystemLock } from "@csq/core/lib/system-lock";
import { drainOutbox } from "@csq/core/lib/outbox";
import {
  connectBaileysChannel,
  disconnectBaileysChannel,
  getBaileysState,
} from "@csq/core/services/baileys";

// Worker-only runtime loop (PRD 23C Phase 6). Executes channel commands
// (connect pairing / disconnect) enqueued by dashboard routes and drains the
// outbound outbox. Runs ONLY inside apps/worker - the process that owns the
// WhatsApp sockets. The system lock on commands keeps a second worker boot
// from executing the same command; the outbox drain locks itself the same
// way (lib/outbox.ts).
//
// Tick cadence 2s: fast enough that chat replies through the outbox feel
// synchronous (the dashboard route bounded-waits ~2 drain intervals), slow
// enough to be a trivial DB load.

const TICK_MS = 2000;

let timer: ReturnType<typeof setInterval> | null = null;

export function startChannelRuntime(): void {
  if (timer) return;
  // Fire once immediately so a command queued while the worker was booting
  // (or redeploying) drains without waiting a tick.
  void tick().catch((err: unknown) => console.error("[runtime] tick threw:", err));
  timer = setInterval(() => {
    void tick().catch((err: unknown) => console.error("[runtime] tick threw:", err));
  }, TICK_MS);
}

export function stopChannelRuntime(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick(): Promise<void> {
  await withSystemLock("channel-commands", 45, processChannelCommands);
  await drainOutbox();
}

async function processChannelCommands(): Promise<void> {
  const commands: ChannelCommand[] = await prisma.channelCommand.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 3,
  });
  for (const cmd of commands) {
    if (cmd.kind === "CONNECT") {
      await runConnectCommand(cmd);
    } else {
      await runDisconnectCommand(cmd);
    }
  }
}

// CONNECT: run the Baileys pairing the dashboard asked for. While
// connectBaileysChannel does its own bounded QR wait, stream the rotating QR
// into the command's `result` so the dashboard's qr route can render the
// CURRENT one (Baileys rotates the QR; showing a stale one fails the scan).
async function runConnectCommand(cmd: ChannelCommand): Promise<void> {
  const channel = await prisma.channel.findUnique({ where: { id: cmd.channelId } });
  if (!channel || channel.provider !== "BAILEYS") {
    await prisma.channelCommand.update({
      where: { id: cmd.id },
      data: { status: "FAILED", error: "Channel bukan Baileys." },
    });
    return;
  }
  console.log(`[runtime] connect command for channel ${cmd.channelId}`);

  let finished = false;
  let lastQr: string | null = null;
  const deadline = Date.now() + 25_000;
  const connectPromise = connectBaileysChannel(channel, { stealLease: true })
    .catch((err: unknown) => {
      console.error(`[runtime] connect command failed for ${cmd.channelId}:`, err);
      return null;
    })
    .finally(() => {
      finished = true;
    });

  const streamQr = async (): Promise<void> => {
    while (!finished && Date.now() < deadline) {
      const st = getBaileysState(channel.id);
      if (st.qr && st.qr !== lastQr) {
        lastQr = st.qr;
        await prisma.channelCommand
          .update({
            where: { id: cmd.id },
            data: { result: { qr: st.qr, open: false, closeCode: null } },
          })
          .catch(() => undefined);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  };

  const [connectResult] = await Promise.all([connectPromise, streamQr()]);
  const result = connectResult ?? { qr: lastQr, open: false, closeCode: null };
  const ok = !!result.qr || result.open;
  await prisma.channelCommand.update({
    where: { id: cmd.id },
    data: {
      status: ok ? "DONE" : "FAILED",
      result: { qr: result.qr, open: result.open, closeCode: result.closeCode },
      error: ok
        ? null
        : `QR tidak terbentuk (closeCode=${result.closeCode ?? "none"})`,
    },
  });
}

// DISCONNECT: full logout (paired device removed on the owner's phone),
// socket teardown, creds deletion, lease release - the existing
// disconnectBaileysChannel. The dashboard route owns the Channel.status
// rewrite and the verify-token rotation, as before.
async function runDisconnectCommand(cmd: ChannelCommand): Promise<void> {
  console.log(`[runtime] disconnect command for channel ${cmd.channelId}`);
  try {
    await disconnectBaileysChannel(cmd.channelId);
    await prisma.channelCommand.update({
      where: { id: cmd.id },
      data: { status: "DONE", result: { qr: null, open: false, closeCode: null } },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal memutus channel.";
    await prisma.channelCommand
      .update({ where: { id: cmd.id }, data: { status: "FAILED", error: message.slice(0, 500) } })
      .catch(() => undefined);
  }
}
