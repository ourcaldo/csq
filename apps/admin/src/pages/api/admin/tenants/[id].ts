import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin, auditAdminAction } from "@/lib/admin-auth";
import { z } from "zod";
import { withSystemContext } from "@csq/core/lib/tenant-context";
import { hashPassword } from "@csq/core/lib/password";
import { resolveEmailProvider } from "@csq/core/lib/email-config";
import { sendEmailWithProvider } from "@csq/core/services/email";
import { createChannelCommand, awaitChannelCommand } from "@csq/core/lib/channel-commands";

// Tenant detail (GET) + actions (POST): suspend/activate, reset_password
// (owner request 2026-11-11), delete. Reset sets a new password for one user
// of this tenant and emails the credentials when a provider is available;
// delete first asks the worker to disconnect the tenant's channels (full
// logout, creds teardown) and then removes the tenant - every table cascades
// on tenant delete, so this is unrecoverable and always audit-logged.

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suspend") }),
  z.object({ action: z.literal("activate") }),
  z.object({
    action: z.literal("reset_password"),
    userId: z.string().uuid(),
    newPassword: z.string().min(8).max(200),
  }),
  z.object({ action: z.literal("delete") }),
]);

// Bounded wait for the worker to execute a channel DISCONNECT before the
// cascade removes the command row. A slow/down worker must not block
// deletion forever - the result reports which channels made it out in time.
const DISCONNECT_WAIT_MS = 12_000;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  return withSystemContext(async () => {

    const { id } = req.query;
    if (typeof id !== "string") {
      return res.status(400).json(apiError("VALIDATION_ERROR", "Invalid tenant ID."));
    }
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) {
      return res.status(404).json(apiError("NOT_FOUND", "Tenant not found."));
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
        return res
          .status(400)
          .json(apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid action."));
      }

      if (parsed.data.action === "reset_password") {
        const { userId, newPassword } = parsed.data;
        const user = await prisma.user.findFirst({
          where: { id: userId, tenantId: id },
          select: { id: true, email: true, name: true },
        });
        if (!user) {
          return res.status(404).json(apiError("NOT_FOUND", "User not found in this tenant."));
        }
        const passwordHash = await hashPassword(newPassword);
        await prisma.user.update({
          where: { id: user.id },
          data: { passwordHash },
        });
        await auditAdminAction({
          adminId: admin.adminId,
          action: "tenant.reset_password",
          targetType: "User",
          targetId: user.id,
          afterValue: { email: user.email },
        });
        // Best-effort credentials email through the tenant's provider or the
        // platform SMTP - the reset succeeds regardless of the send result.
        let emailed = false;
        try {
          const provider = await resolveEmailProvider(id);
          if (provider) {
            const loginUrl = (process.env.DASHBOARD_URL ?? "https://csq-dashboard.onrender.com").replace(/\/$/, "");
            await sendEmailWithProvider(provider, {
              to: user.email,
              subject: "Password CSQ Anda telah direset",
              text:
                `Halo ${user.name ?? user.email},\n\n` +
                `Password akun CSQ Anda (${user.email}) telah direset oleh admin platform.\n\n` +
                `Masuk di: ${loginUrl}\n` +
                `Email: ${user.email}\n` +
                `Password baru: ${newPassword}\n\n` +
                "Jika Anda tidak merasa meminta reset ini, hubungi admin platform Anda.",
            });
            emailed = true;
          }
        } catch {
          emailed = false;
        }
        return res.status(200).json(apiOk({ reset: true, email: user.email, emailed }));
      }

      if (parsed.data.action === "delete") {
        // Ask the worker to disconnect every channel first so no live socket
        // outlives the rows it reads (full logout + BaileysAuth teardown).
        const channels = await prisma.channel.findMany({
          where: { tenantId: id },
          select: { id: true },
        });
        const commands = await Promise.all(
          channels.map((c) =>
            createChannelCommand({
              tenantId: id,
              channelId: c.id,
              kind: "DISCONNECT",
              requestedBy: admin.adminId,
            })
          )
        );
        const results = await Promise.all(
          commands.map((cmdId) => awaitChannelCommand(cmdId, DISCONNECT_WAIT_MS))
        );
        const channelsDisconnected = results.filter((r) => r.done).length;

        // Snapshot for the audit BEFORE the cascade removes everything - the
        // admin action log is platform-scoped and survives the delete.
        const counts = {
          users: await prisma.user.count({ where: { tenantId: id } }),
          conversations: await prisma.conversation.count({ where: { tenantId: id } }),
          messages: await prisma.message.count({ where: { tenantId: id } }),
          orders: await prisma.order.count({ where: { tenantId: id } }),
        };
        await auditAdminAction({
          adminId: admin.adminId,
          action: "tenant.delete",
          targetType: "Tenant",
          targetId: id,
          beforeValue: { name: tenant.name, slug: tenant.slug, ...counts },
          afterValue: { deleted: true },
        });

        await prisma.tenant.delete({ where: { id } });
        return res
          .status(200)
          .json(apiOk({ deleted: true, channelsDisconnected, channelsTotal: channels.length }));
      }

      const newStatus = parsed.data.action === "suspend" ? "SUSPENDED" : "ACTIVE";
      if (tenant.status === newStatus) {
        return res.status(200).json(apiOk({ id: tenant.id, status: tenant.status }));
      }

      const updated = await prisma.tenant.update({
        where: { id }, data: { status: newStatus },
        select: { id: true, status: true },
      });

      // SEC-4 (PRD 16): suspend moves ACTIVE campaigns to PAUSED (marked
      // autoPaused); activate resumes exactly those. The worker's engine
      // guards are the backstop if a campaign flips between the status write
      // and this one.
      if (parsed.data.action === "suspend") {
        await prisma.campaign.updateMany({
          where: { tenantId: id, status: "ACTIVE" },
          data: { status: "PAUSED", autoPaused: true },
        });
      } else {
        await prisma.campaign.updateMany({
          where: { tenantId: id, status: "PAUSED", autoPaused: true },
          data: { status: "ACTIVE", autoPaused: false },
        });
      }

      await auditAdminAction({
        adminId: admin.adminId,
        action: parsed.data.action === "suspend" ? "tenant.suspend" : "tenant.activate",
        targetType: "Tenant", targetId: id,
        beforeValue: { status: tenant.status },
        afterValue: { status: newStatus },
      });

      // The enforcement matrix (PRD 13 + PRD 16 SEC-4):
      // - Login + sessions: authorize still authenticates, but every SSR page
      //   redirects to /suspended and getAuthSession returns null.
      // - Agent loop: stands down (core agent-loop tenant status check).
      // - Campaigns/scenarios/scheduled sends: guarded by tenantActive() in
      //   the worker engines; ACTIVE campaigns are PAUSED above.
      // - API token realm: keys and JWTs of a suspended tenant stop
      //   authenticating (requireApiAuth) with TENANT_SUSPENDED on mint.
      // - Channels: sockets stay connected so inbound keeps ingesting - data
      //   is never lost, the tenant simply stops answering.

      return res.status(200).json(apiOk(updated));
    }

    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));

  });
}
