import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { cloudApiConfigSchema, baileysConfigSchema } from "@/types/whatsapp";

// List the tenant's WhatsApp channels (plan 7.5). Read-only; any authenticated
// tenant user may view. The `config` Json blob holds provider secrets (Cloud API
// token/appSecret), so we sanitize with the existing Zod schemas before
// returning — only non-secret fields (phoneNumberId for Cloud API,
// tosAcknowledged for Baileys) are exposed to the client. No `as` casts: the
// stored config is parsed at the boundary and only the validated fields leave.

export type ChannelView = {
  id: string;
  provider: "CLOUD_API" | "BAILEYS";
  type: "WHATSAPP";
  status: string;
  agentId: string | null;
  phoneNumberId?: string;
  tosAcknowledged?: boolean;
  createdAt: string;
  updatedAt: string;
};

type RawChannel = {
  id: string;
  provider: string;
  type: string;
  status: string;
  agentId: string | null;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function sanitize(channel: RawChannel): ChannelView {
  let phoneNumberId: string | undefined;
  let tosAcknowledged: boolean | undefined;
  if (channel.provider === "CLOUD_API") {
    const parsed = cloudApiConfigSchema.safeParse(channel.config);
    if (parsed.success) phoneNumberId = parsed.data.phoneNumberId;
  } else if (channel.provider === "BAILEYS") {
    const parsed = baileysConfigSchema.safeParse(channel.config);
    if (parsed.success) tosAcknowledged = parsed.data.tosAcknowledged;
  }
  return {
    id: channel.id,
    provider: z.enum(["CLOUD_API", "BAILEYS"]).parse(channel.provider),
    type: z.enum(["WHATSAPP"]).parse(channel.type),
    status: channel.status,
    agentId: channel.agentId,
    phoneNumberId,
    tosAcknowledged,
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString(),
  };
}

export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ items: ChannelView[] }>>
) {
  if (_req.method !== "GET") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const session = await getAuthSession(_req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  const channels = await prisma.channel.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
  });

  return res
    .status(200)
    .json(apiOk({ items: channels.map(sanitize) }));
}
