import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@csq/core/lib/auth";
import { canManageChannel } from "@csq/core/lib/channel-access";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError, strQuery } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { createChannelCommand, awaitChannelCommand } from "@csq/core/lib/channel-commands";

// Disconnect a channel: mark DISCONNECTED and, for Baileys, tear down the
// socket. OWNER-only, tenant-scoped (plan 7.5). PRD 15: the Cloud API verify
// token is app-level now - no rotation here (one token serves every number;
// rotating on one channel's disconnect would break the others).
export type DisconnectResult = { id: string; status: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<DisconnectResult>>
) {
  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const id = strQuery(req.query, "id");
    if (!id) return respondError(res, "VALIDATION_ERROR", "ID channel tidak valid.");

    const channel = await prisma.channel.findFirst({ where: { id, tenantId } });
    if (!channel) return respondError(res, "NOT_FOUND", "Channel tidak ditemukan.");
    // PRD 29 section 6.1: disconnect is a per-channel KELOLA power.
    if (!(await canManageChannel(session, channel.id))) {
      return respondError(res, "PERMISSION_DENIED", "Tidak punya akses kelola saluran ini.");
    }

    if (channel.provider === "BAILEYS") {
      // Phase 6: the socket lives in the worker - teardown is a command. If
      // the worker is unreachable, still delete the saved creds from here so a
      // reconnect requires a fresh QR (with the worker down no socket can be
      // alive; the late-executed command is an idempotent no-op).
      const cmdId = await createChannelCommand({
        tenantId,
        channelId: channel.id,
        kind: "DISCONNECT",
        requestedBy: session.user.id,
      });
      const result = await awaitChannelCommand(cmdId, 15_000);
      if (!result.done && !result.failed) {
        await prisma.baileysAuth
          .delete({ where: { channelId: channel.id } })
          .catch(() => undefined);
      }
    }

    const updated = await prisma.channel.update({
      where: { id: channel.id },
      data: { status: "DISCONNECTED" },
      select: { id: true, status: true },
    });

    return res.status(200).json(apiOk(updated));
  });
}
