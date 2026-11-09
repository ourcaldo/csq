import prisma from "@csq/core/lib/db";
import type { Channel, OutboundMessage, OutboundSource } from "@prisma/client";
import { getProvider } from "@csq/core/lib/whatsapp-provider";
import { withSystemLock } from "@csq/core/lib/system-lock";
import {
  withSystemContext,
  withTenantContext,
} from "@csq/core/lib/tenant-context";

// Outbound send queue (PRD 23C Phase 6). Web processes (the dashboard) no
// longer hold WhatsApp sockets, so every send a dashboard route initiates
// becomes an OutboundMessage row that the worker drains. Sends initiated
// inside the worker itself (agent replies from Baileys inbound, scenario
// nodes, session-close, campaign engine) still send in-process where the
// socket lives - only sends from socket-less processes enqueue.
//
// Postgres-as-queue, same pattern as CampaignMessage: no Redis (stack
// constraint). The bounded await below keeps the dashboard routes' old
// synchronous UX (send + confirm in one request) at the cost of one drain
// interval (worker polls every 2s) of extra latency.

const TERMINAL: ReadonlySet<string> = new Set(["SENT", "FAILED", "CANCELLED"]);

export async function enqueueOutbound(input: {
  tenantId: string;
  channelId: string;
  to: string;
  body?: string;
  templateName?: string;
  language?: string;
  source: OutboundSource;
}): Promise<string> {
  const row = await prisma.outboundMessage.create({
    data: {
      tenantId: input.tenantId,
      channelId: input.channelId,
      toJid: input.to,
      body: input.body ?? null,
      templateName: input.templateName ?? null,
      language: input.language ?? null,
      source: input.source,
    },
    select: { id: true },
  });
  return row.id;
}

// Bounded poll for a row's terminal status. On timeout, try to CANCEL a row
// that is still QUEUED (worker down - nothing was sent). A row already
// SENDING may still deliver after a timeout; that rare ghost is the accepted
// edge of the queue pattern (same class as Baileys' async delivery-failure
// stubs) and is bounded by the drain being at most one send in flight.
export async function awaitOutbound(
  id: string,
  timeoutMs = 20_000
): Promise<{ status: string; waMessageId: string | null; error: string | null }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await prisma.outboundMessage.findUnique({
      where: { id },
      select: { status: true, waMessageId: true, error: true },
    });
    if (row && TERMINAL.has(row.status)) {
      return { status: row.status, waMessageId: row.waMessageId, error: row.error };
    }
    if (Date.now() >= deadline) {
      if (row && row.status === "QUEUED") {
        await prisma.outboundMessage
          .updateMany({ where: { id, status: "QUEUED" }, data: { status: "CANCELLED" } })
          .catch(() => undefined);
      }
      return { status: row?.status ?? "UNKNOWN", waMessageId: row?.waMessageId ?? null, error: "Send timed out - worker tidak merespons." };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

// Drain one batch of queued sends. Worker-only (it owns the providers); the
// system lock keeps a second worker boot from double-draining.
export async function drainOutbox(): Promise<void> {
  await withSystemLock("outbox-drain", 60, async () => {
    const rows: OutboundMessage[] = await withSystemContext(async () =>
      prisma.outboundMessage.findMany({
        where: { status: "QUEUED" },
        orderBy: { createdAt: "asc" },
        take: 20,
      })
    );
    for (const row of rows) {
      await withTenantContext(row.tenantId, async () => {
        await prisma.outboundMessage.update({
          where: { id: row.id },
          data: { status: "SENDING" },
        });
        try {
          const channel: Channel | null = await prisma.channel.findUnique({
            where: { id: row.channelId },
          });
          if (!channel || channel.status !== "CONNECTED") {
            throw new Error("Channel tidak terhubung.");
          }
          const provider = getProvider(channel);
          const result = row.templateName
            ? await provider.sendTemplate({
                to: row.toJid,
                templateName: row.templateName,
                languageCode: row.language ?? "id",
              })
            : await provider.sendText({ to: row.toJid, body: row.body ?? "" });
          await prisma.outboundMessage.update({
            where: { id: row.id },
            data: {
              status: "SENT",
              waMessageId: result.waMessageId ?? null,
              sentAt: new Date(),
              error: null,
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Gagal mengirim.";
          await prisma.outboundMessage
            .update({
              where: { id: row.id },
              data: { status: "FAILED", error: message.slice(0, 500) },
            })
            .catch(() => undefined);
        }
      });
    }
  });
}
