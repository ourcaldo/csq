import prisma from "@csq/core/lib/db";
import type { ChannelCommandKind } from "@prisma/client";
import { channelCommandResultSchema } from "@csq/core/types/channel-queue";

// Channel command queue (PRD 23C Phase 6). Connect/QR/disconnect used to be
// in-process calls into the Baileys socket map; the socket now lives in the
// worker, so the dashboard routes enqueue a ChannelCommand and the worker
// executes it (services/channel-runtime.ts). The command row doubles as the
// QR transport: while a CONNECT is pending, the worker streams Baileys'
// rotating QR into `result` so the dashboard's qr route can poll it.

export async function createChannelCommand(input: {
  tenantId: string;
  channelId: string;
  kind: ChannelCommandKind;
  requestedBy: string;
}): Promise<string> {
  const row = await prisma.channelCommand.create({
    data: {
      tenantId: input.tenantId,
      channelId: input.channelId,
      kind: input.kind,
      requestedBy: input.requestedBy,
    },
    select: { id: true },
  });
  return row.id;
}

// Bounded poll until the command reaches a terminal status. Returns the
// parsed result (qr/open/closeCode) plus error text - both null-ish when the
// command is still pending at timeout (worker down).
export async function awaitChannelCommand(
  id: string,
  timeoutMs: number
): Promise<{
  done: boolean;
  failed: boolean;
  qr: string | null;
  open: boolean;
  closeCode: number | null;
  error: string | null;
}> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await prisma.channelCommand.findUnique({
      where: { id },
      select: { status: true, result: true, error: true },
    });
    if (row && (row.status === "DONE" || row.status === "FAILED")) {
      const parsed = channelCommandResultSchema.safeParse(row.result ?? {});
      const result = parsed.success ? parsed.data : {};
      return {
        done: row.status === "DONE",
        failed: row.status === "FAILED",
        qr: result.qr ?? null,
        open: result.open ?? false,
        closeCode: result.closeCode ?? null,
        error: row.error,
      };
    }
    if (Date.now() >= deadline) {
      return { done: false, failed: false, qr: null, open: false, closeCode: null, error: "Worker tidak merespons." };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}
