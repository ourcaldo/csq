import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireOwner } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { requireTenant, respondError, strQuery } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

// PRD 29 section 6 - per-channel access grants. Owner-only CRUD (the grant
// UI lives on the Saluran page). GET lists the channel's grants with the
// principal names; PUT REPLACES the channel's grant set (simple full-state
// write from the panel). Every change is audit-logged with the actor.

export type AccessGrantView = {
  id: string;
  principal: "ROLE" | "USER";
  principalId: string;
  principalName: string;
  canView: boolean;
  canCompose: boolean;
  canManage: boolean;
};

const grantSchema = z.object({
  principal: z.enum(["ROLE", "USER"]),
  principalId: z.string().uuid(),
  canView: z.boolean(),
  canCompose: z.boolean(),
  canManage: z.boolean(),
});

const putSchema = z.object({
  grants: z.array(grantSchema).max(200),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ items: AccessGrantView[] }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireOwner(session)) {
    return respondError(res, "PERMISSION_DENIED", "Hanya pemilik yang dapat mengatur akses saluran.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const channelId = strQuery(req.query, "id");
    if (!channelId) return respondError(res, "VALIDATION_ERROR", "ID saluran tidak valid.");
    const channel = await prisma.channel.findFirst({ where: { id: channelId, tenantId } });
    if (!channel) return respondError(res, "NOT_FOUND", "Saluran tidak ditemukan.");

    if (req.method === "GET") {
      const rows = await prisma.channelAccess.findMany({
        where: { tenantId, channelId },
        orderBy: { createdAt: "asc" },
      });
      const items: AccessGrantView[] = await Promise.all(
        rows.map(async (r) => ({
          id: r.id,
          principal: r.principal === "USER" ? "USER" : "ROLE",
          principalId: r.principalId,
          principalName: await principalName(r.principal, r.principalId, tenantId),
          canView: r.canView,
          canCompose: r.canCompose,
          canManage: r.canManage,
        }))
      );
      return res.status(200).json(apiOk({ items }));
    }

    if (req.method === "PUT") {
      const parsed = putSchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(res, "VALIDATION_ERROR", "Input tidak valid.");
      }
      // Principals must belong to this tenant.
      for (const g of parsed.data.grants) {
        const ok =
          g.principal === "USER"
            ? !!(await prisma.user.findFirst({ where: { id: g.principalId, tenantId }, select: { id: true } }))
            : !!(await prisma.role.findFirst({ where: { id: g.principalId, tenantId }, select: { id: true } }));
        if (!ok) {
          return respondError(res, "VALIDATION_ERROR", "Peran atau anggota tidak ditemukan.");
        }
      }
      await prisma.$transaction([
        prisma.channelAccess.deleteMany({ where: { tenantId, channelId } }),
        ...parsed.data.grants.map((g) =>
          prisma.channelAccess.create({
            data: {
              tenantId,
              channelId,
              principal: g.principal,
              principalId: g.principalId,
              canView: g.canView,
              canCompose: g.canCompose,
              canManage: g.canManage,
            },
          })
        ),
      ]);
      await logHuman({
        actorEmail: session.user.email ?? undefined,
        tenantId,
        action: "channel.access_changed",
        entityType: "Channel",
        entityId: channelId,
        beforeValue: { channel: channel.label },
        afterValue: { grants: parsed.data.grants },
      });
      const items: AccessGrantView[] = parsed.data.grants.map((g) => ({
        id: `${g.principal}:${g.principalId}`,
        principal: g.principal,
        principalId: g.principalId,
        principalName: "",
        canView: g.canView,
        canCompose: g.canCompose,
        canManage: g.canManage,
      }));
      return res.status(200).json(apiOk({ items }));
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}

async function principalName(
  principal: string,
  principalId: string,
  tenantId: string
): Promise<string> {
  if (principal === "USER") {
    const u = await prisma.user.findFirst({
      where: { id: principalId, tenantId },
      select: { name: true, email: true },
    });
    return u?.name ?? u?.email ?? "?";
  }
  const r = await prisma.role.findFirst({
    where: { id: principalId, tenantId },
    select: { name: true },
  });
  return r?.name ?? "?";
}
