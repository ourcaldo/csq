import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import {
  cloudApiConfigSchema,
  baileysConfigSchema,
  type CloudApiConfig,
  type BaileysConfig,
} from "@/types/whatsapp";
import { connectBaileysChannel } from "@/services/baileys";

// Connect (or reconfigure) a WhatsApp channel for this tenant (plan 7.5).
// Owner picks the provider at onboarding. Baileys is gated on tosAcknowledged
// (ToS/ban risk, FR-WA-011) — enforced HERE in the backend, not just the UI.
// For Baileys, starts the socket and returns the QR to scan; for Cloud API,
// stores the credentials and marks CONNECTED.

const connectSchema = z.object({
  provider: z.enum(["CLOUD_API", "BAILEYS"]),
  agentId: z.string().uuid().optional(),
  config: z.unknown(),
});

export type ConnectResult = {
  channelId: string;
  provider: string;
  status: string;
  qr: string | null;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ConnectResult>>
) {
  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengatur channel.");
  }
  const tenantId = requireTenant(session);

  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) {
    return respondError(res, "VALIDATION_ERROR", parsed.error.message);
  }
  const { provider, agentId } = parsed.data;

  let config: CloudApiConfig | BaileysConfig;
  let status: "CONNECTED" | "DISCONNECTED";
  if (provider === "CLOUD_API") {
    const cfg = cloudApiConfigSchema.parse(parsed.data.config);
    config = cfg;
    status = "CONNECTED";
  } else {
    const cfg = baileysConfigSchema.parse(parsed.data.config);
    if (!cfg.tosAcknowledged) {
      return respondError(
        res,
        "PERMISSION_DENIED",
        "Baileys berisiko banned. Owner harus menyetujui tosAcknowledged sebelum mengaktifkan."
      );
    }
    config = cfg;
    status = "DISCONNECTED"; // until the QR is scanned and the socket opens
  }

  // Upsert the tenant's channel for this provider (one per provider for MVP).
  const existing = await prisma.channel.findFirst({
    where: { tenantId, provider },
  });
  const channel = existing
    ? await prisma.channel.update({
        where: { id: existing.id },
        data: { agentId: agentId ?? existing.agentId, config, status },
      })
    : await prisma.channel.create({
        data: {
          tenantId,
          agentId,
          type: "WHATSAPP",
          provider,
          config,
          status,
        },
      });

  let qr: string | null = null;
  if (provider === "BAILEYS") {
    const result = await connectBaileysChannel(channel);
    qr = result.qr;
  }

  return res.status(200).json(
    apiOk({
      channelId: channel.id,
      provider: channel.provider,
      status: channel.provider === "BAILEYS" ? status : channel.status,
      qr,
    })
  );
}
