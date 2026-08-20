import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError, strQuery } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { disconnectBaileysChannel } from "@/services/baileys";

// Disconnect a channel: mark DISCONNECTED and, for Baileys, tear down the
// socket. OWNER-only, tenant-scoped (plan 7.5).
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

  const id = strQuery(req.query, "id");
  if (!id) return respondError(res, "VALIDATION_ERROR", "ID channel tidak valid.");

  const channel = await prisma.channel.findFirst({ where: { id, tenantId } });
  if (!channel) return respondError(res, "NOT_FOUND", "Channel tidak ditemukan.");

  if (channel.provider === "BAILEYS") {
    await disconnectBaileysChannel(channel.id);
  }

  const updated = await prisma.channel.update({
    where: { id: channel.id },
    data: { status: "DISCONNECTED" },
    select: { id: true, status: true },
  });

  return res.status(200).json(apiOk(updated));
}
