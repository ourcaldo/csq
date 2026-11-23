import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@csq/core/lib/auth";
import { canManageChannel } from "@csq/core/lib/channel-access";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError, strQuery } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { channelCommandResultSchema } from "@csq/core/types/channel-queue";

// Live QR + open state for a Baileys channel (the Saluran page polls this
// while a QR is showing). OWNER-only: the QR is a login secret. Baileys
// rotates the QR periodically, so the page must read the *current* one rather
// than the QR returned by the initial connect call. Returns qr:null when no
// socket is running - the caller should re-connect (Tampilkan QR again).

export type QrStateResult = { qr: string | null; open: boolean };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<QrStateResult>>
) {
  if (req.method !== "GET") {
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
    // PRD 29 section 6.1: reading the live QR is the session pairing power -
    // per-channel KELOLA grant required (the QR is a login secret).
    if (!(await canManageChannel(session, channel.id))) {
      return respondError(res, "PERMISSION_DENIED", "Tidak punya akses kelola saluran ini.");
    }
    if (channel.provider !== "BAILEYS") {
      return respondError(res, "VALIDATION_ERROR", "Channel bukan Baileys.");
    }

    // Phase 6: the socket lives in the worker. While a CONNECT command is in
    // flight, the worker streams the rotating QR into that command's result -
    // read the latest one. No recent command: nothing is pairing, so qr:null
    // (the Saluran page tells the owner to click Tampilkan QR again).
    const cmd = await prisma.channelCommand.findFirst({
      where: {
        channelId: channel.id,
        kind: "CONNECT",
        createdAt: { gte: new Date(Date.now() - 3 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
    });
    let qr: string | null = null;
    if (cmd) {
      const parsed = channelCommandResultSchema.safeParse(cmd.result ?? {});
      if (parsed.success) {
        qr = parsed.data.qr ?? null;
      }
    }
    return res
      .status(200)
      .json(apiOk({ qr, open: channel.status === "CONNECTED" }));
  });
}
