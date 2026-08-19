import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError, strQuery } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { getBaileysState } from "@/services/baileys";

// Live QR + open state for a Baileys channel (the Saluran page polls this
// while a QR is showing). OWNER-only: the QR is a login secret. Baileys
// rotates the QR periodically, so the page must read the *current* one rather
// than the QR returned by the initial connect call. Returns qr:null when no
// socket is running — the caller should re-connect (Tampilkan QR again).

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
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner.");
  }
  const tenantId = requireTenant(session);

  const id = strQuery(req.query, "id");
  if (!id) return respondError(res, "VALIDATION_ERROR", "ID channel tidak valid.");

  const channel = await prisma.channel.findFirst({ where: { id, tenantId } });
  if (!channel) return respondError(res, "NOT_FOUND", "Channel tidak ditemukan.");
  if (channel.provider !== "BAILEYS") {
    return respondError(res, "VALIDATION_ERROR", "Channel bukan Baileys.");
  }

  return res.status(200).json(apiOk(getBaileysState(channel.id)));
}
