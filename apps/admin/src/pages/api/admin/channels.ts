import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin, auditAdminAction } from "@/lib/admin-auth";
import { createChannelCommand } from "@csq/core/lib/channel-commands";
import { z } from "zod";

// Channel fleet (PRD 13 Phase 3): every channel across tenants.
// Operator actions reuse the Phase 6 ChannelCommand machinery.

const actionSchema = z.object({
  channelId: z.string().uuid(),
  action: z.enum(["reconnect", "disconnect"]),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === "GET") {
    const channels = await prisma.channel.findMany({
      orderBy: { createdAt: "desc" },
      include: { tenant: { select: { name: true, slug: true, status: true } } },
    });
    const leases = await prisma.systemLock.findMany({
      where: { key: { startsWith: "baileys-socket:" } },
    });
    const leaseMap = new Map(leases.map((l) => [l.key.replace("baileys-socket:", ""), l]));
    const items = channels.map((c) => {
      const lease = leaseMap.get(c.id);
      return {
        id: c.id, tenantName: c.tenant.name, tenantSlug: c.tenant.slug,
        tenantStatus: c.tenant.status, provider: c.provider, type: c.type,
        status: c.status, createdAt: c.createdAt.toISOString(),
        leaseHeld: lease ? lease.lockedUntil > new Date() : false,
        leaseUntil: lease?.lockedUntil?.toISOString() ?? null,
      };
    });
    return res.status(200).json(apiOk({ items }));
  }

  if (req.method === "POST") {
    const parsed = actionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload tidak valid."));
    }
    const { channelId, action } = parsed.data;
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { tenant: { select: { id: true, name: true } } },
    });
    if (!channel) {
      return res.status(404).json(apiError("NOT_FOUND", "Channel tidak ditemukan."));
    }
    const cmdId = await createChannelCommand({
      tenantId: channel.tenantId,
      channelId: channel.id,
      kind: action === "reconnect" ? "CONNECT" : "DISCONNECT",
      requestedBy: admin.adminId,
    });
    await auditAdminAction({
      adminId: admin.adminId,
      action: `channel.${action}`,
      targetType: "Channel",
      targetId: channel.id,
      afterValue: { tenant: channel.tenant.name, provider: channel.provider },
    });
    return res.status(202).json(apiOk({ commandId: cmdId }));
  }

  return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));
}
