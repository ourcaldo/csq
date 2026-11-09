import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError, strQuery } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { createChannelCommand, awaitChannelCommand } from "@csq/core/lib/channel-commands";
import { generateVerifyToken } from "@csq/core/lib/whatsapp-verify-token";

// Disconnect a channel: mark DISCONNECTED and, for Baileys, tear down the
// socket. For Cloud API, also ROTATE the webhook verify token - a fresh token
// on every disable→enable cycle. OWNER-only, tenant-scoped (plan 7.5).
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
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat memutus channel.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const id = strQuery(req.query, "id");
    if (!id) return respondError(res, "VALIDATION_ERROR", "ID channel tidak valid.");

    const channel = await prisma.channel.findFirst({ where: { id, tenantId } });
    if (!channel) return respondError(res, "NOT_FOUND", "Channel tidak ditemukan.");

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

    // Rotate the Cloud API verify token on disconnect so any stale token left
    // in Meta's webhook config stops working, and the next visit to the connect
    // step shows a fresh value.
    const data: Prisma.ChannelUpdateInput = { status: "DISCONNECTED" };
    if (channel.provider === "CLOUD_API") {
      const rawConfig = z.record(z.unknown()).safeParse(channel.config);
      data.config = {
        ...(rawConfig.success ? rawConfig.data : {}),
        verifyToken: generateVerifyToken(),
      };
    }

    const updated = await prisma.channel.update({
      where: { id: channel.id },
      data,
      select: { id: true, status: true },
    });

    return res.status(200).json(apiOk(updated));
  });
}
