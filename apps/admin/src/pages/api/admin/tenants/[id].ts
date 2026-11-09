import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin, auditAdminAction } from "@/lib/admin-auth";
import { z } from "zod";
import { withSystemContext } from "@csq/core/lib/tenant-context";

// Tenant detail (GET) + suspend/activate (POST) (PRD 13 Phase 2).

const actionSchema = z.object({ action: z.enum(["suspend", "activate"]) });

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  return withSystemContext(async () => {

    const { id } = req.query;
    if (typeof id !== "string") {
      return res.status(400).json(apiError("VALIDATION_ERROR", "ID tenant tidak valid."));
    }
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) {
      return res.status(404).json(apiError("NOT_FOUND", "Tenant tidak ditemukan."));
    }

    if (req.method === "GET") {
      const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const [users, channels, agents, campaigns, dataSources, mediaAssets, messageCount30d, conversationCount] =
        await Promise.all([
          prisma.user.findMany({ where: { tenantId: id }, select: { id: true, email: true, name: true, role: true } }),
          prisma.channel.findMany({ where: { tenantId: id }, select: { id: true, provider: true, status: true, type: true } }),
          prisma.agent.findMany({ where: { tenantId: id }, select: { id: true, name: true, status: true } }),
          prisma.campaign.findMany({ where: { tenantId: id }, select: { id: true, name: true, status: true, scheduleKind: true } }),
          prisma.dataSource.findMany({ where: { tenantId: id }, select: { id: true, name: true, type: true, status: true, lastSyncAt: true } }),
          prisma.mediaAsset.aggregate({ where: { tenantId: id }, _sum: { byteSize: true } }),
          prisma.message.count({ where: { tenantId: id, createdAt: { gte: cutoff30d } } }),
          prisma.conversation.count({ where: { tenantId: id } }),
        ]);
      return res.status(200).json(apiOk({
        id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status,
        createdAt: tenant.createdAt.toISOString(),
        userCount: users.length, channelCount: channels.length,
        conversationCount, messageCount30d,
        mediaBytes: mediaAssets._sum.byteSize ?? 0,
        users, channels, agents, campaigns,
        dataSources: dataSources.map((d) => ({ ...d, lastSyncAt: d.lastSyncAt?.toISOString() ?? null })),
      }));
    }

    if (req.method === "POST") {
      const parsed = actionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json(apiError("VALIDATION_ERROR", "Aksi harus 'suspend' atau 'activate'."));
      }

      const newStatus = parsed.data.action === "suspend" ? "SUSPENDED" : "ACTIVE";
      if (tenant.status === newStatus) {
        return res.status(200).json(apiOk({ id: tenant.id, status: tenant.status }));
      }

      const updated = await prisma.tenant.update({
        where: { id }, data: { status: newStatus },
        select: { id: true, status: true },
      });

      await auditAdminAction({
        adminId: admin.adminId,
        action: parsed.data.action === "suspend" ? "tenant.suspend" : "tenant.activate",
        targetType: "Tenant", targetId: id,
        beforeValue: { status: tenant.status },
        afterValue: { status: newStatus },
      });

      // The enforcement matrix (PRD 13):
      // - Login + sessions: blocked by getAuthSession/authorize (core)
      // - Agent loop: stands down on the next turn (core)
      // - Channels: the worker disconnects them on the next heartbeat
      //   (it finds status != CONNECTED and stands down)
      // - Inbound: keeps ingesting (the socket layer doesn't check tenant
      //   status) - data is never lost

      return res.status(200).json(apiOk(updated));
    }

    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));

  });
}
