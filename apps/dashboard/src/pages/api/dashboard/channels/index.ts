import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession } from "@csq/core/lib/auth";
import { manageChannelIds } from "@csq/core/lib/channel-access";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { cloudApiConfigSchema, baileysConfigSchema } from "@csq/core/types/whatsapp";

// List the tenant's WhatsApp channels (plan 7.5). Read-only; any authenticated
// tenant user may view. The `config` Json blob holds provider secrets (Cloud API
// token/appSecret), so we sanitize with the existing Zod schemas before
// returning - only non-secret fields (phoneNumberId for Cloud API,
// tosAcknowledged for Baileys) are exposed to the client. No `as` casts: the
// stored config is parsed at the boundary and only the validated fields leave.

export type ChannelView = {
  id: string;
  provider: "CLOUD_API" | "BAILEYS";
  type: "WHATSAPP";
  status: string;
  label: string;
  agentId: string | null;
  phoneNumber: string | null;
  externalId: string | null;
  wabaId: string | null;
  archivedAt: string | null;
  phoneNumberId?: string;
  tosAcknowledged?: boolean;
  // PRD 29 section 6.1: whether the requesting user holds KELOLA on this
  // channel (QR scan, disconnect, test) - drives the Saluran page buttons.
  canManage?: boolean;
  createdAt: string;
  updatedAt: string;
};

type RawChannel = {
  id: string;
  provider: string;
  type: string;
  status: string;
  label: string;
  agentId: string | null;
  phoneNumber: string | null;
  externalId: string | null;
  wabaId: string | null;
  archivedAt: Date | null;
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
    label: channel.label,
    agentId: channel.agentId,
    phoneNumber: channel.phoneNumber,
    externalId: channel.externalId,
    wabaId: channel.wabaId,
    archivedAt: channel.archivedAt ? channel.archivedAt.toISOString() : null,
    phoneNumberId,
    tosAcknowledged,
    canManage: false,
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

  return withTenantContext(tenantId, async () => {
    // Archived channels are hidden from the working list (PRD 15); data
    // stays queryable everywhere else. ?includeArchived=1 returns them too
    // (the Diarsipkan tab) - with their archivedAt timestamp for the UI.
    const includeArchived = _req.query.includeArchived === "1";
    const channels = await prisma.channel.findMany({
      where: { tenantId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: { createdAt: "asc" },
    });

    // PRD 29: per-channel KELOLA for the requesting user, one grant lookup.
    const manageIds = await manageChannelIds(session);
    const items = channels.map((c) => ({
      ...sanitize(c),
      canManage: manageIds === null || manageIds.includes(c.id),
    }));

    return res
      .status(200)
      .json(apiOk({ items }));
  });
}
