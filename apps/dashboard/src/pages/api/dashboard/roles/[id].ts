import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { requireTenant, respondError, strQuery } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { OWNER_ONLY_KEYS } from "@csq/core/lib/permissions-catalog";

export type RoleItem = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
  createdAt: string;
  updatedAt: string;
};

// PRD 29 - role update/delete. PUT: name/description/permissions (system
// roles only allow permission edits, never rename/delete). DELETE: custom
// roles only; users on a deleted role drop to no permissions (roleId
// SetNull) and the UI warns - the access rows referencing the role
// cascade-clear (PRD section 7).

const updateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(200).nullable().optional(),
  permissions: z.array(z.string()).optional(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<RoleItem>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requirePermission(session, "peran.kelola")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya pemilik yang dapat mengelola peran.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const id = strQuery(req.query, "id");
    if (!id) return respondError(res, "VALIDATION_ERROR", "ID peran tidak valid.");
    const role = await prisma.role.findFirst({ where: { id, tenantId } });
    if (!role) return respondError(res, "NOT_FOUND", "Peran tidak ditemukan.");

    if (req.method === "PUT") {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(res, "VALIDATION_ERROR", "Input tidak valid.");
      }
      // System roles: permission edits only (support burden, PRD 29 section 4).
      if (role.isSystem && (parsed.data.name !== undefined || parsed.data.description !== undefined)) {
        return respondError(res, "VALIDATION_ERROR", "Peran bawaan tidak dapat diubah namanya.");
      }
      if (parsed.data.name && parsed.data.name !== role.name) {
        const exists = await prisma.role.findFirst({
          where: { tenantId, name: parsed.data.name },
          select: { id: true },
        });
        if (exists) return respondError(res, "VALIDATION_ERROR", "Nama peran sudah dipakai.");
      }
      const updated = await prisma.role.update({
        where: { id: role.id },
        data: {
          ...(parsed.data.name ? { name: parsed.data.name } : {}),
          ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
          ...(parsed.data.permissions
            ? {
                permissions: [
                  ...new Set(
                    parsed.data.permissions.filter((k) => !OWNER_ONLY_KEYS.includes(k))
                  ),
                ],
              }
            : {}),
        },
      });
      await logHuman({
        actorEmail: session.user.email ?? undefined,
        tenantId,
        action: "role.updated",
        entityType: "Role",
        entityId: role.id,
        beforeValue: { name: role.name, permissions: role.permissions },
        afterValue: { name: updated.name, permissions: updated.permissions },
      });
      return res.status(200).json(
        apiOk({
          id: updated.id,
          name: updated.name,
          description: updated.description,
          isSystem: updated.isSystem,
          permissions: updated.permissions,
          userCount: 0,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        })
      );
    }

    if (req.method === "DELETE") {
      if (role.isSystem) {
        return respondError(res, "VALIDATION_ERROR", "Peran bawaan tidak dapat dihapus - duplikatkan dulu.");
      }
      const users = await prisma.user.count({ where: { tenantId, roleId: role.id } });
      if (users > 0) {
        return respondError(
          res,
          "VALIDATION_ERROR",
          `Masih ada ${users} anggota dengan peran ini - pindahkan dulu.`
        );
      }
      // ChannelAccess rows naming this role cascade-clear (no FK - remove
      // them explicitly so a stale grant cannot linger).
      await prisma.channelAccess.deleteMany({
        where: { tenantId, principal: "ROLE", principalId: role.id },
      });
      await prisma.role.delete({ where: { id: role.id } });
      await logHuman({
        actorEmail: session.user.email ?? undefined,
        tenantId,
        action: "role.deleted",
        entityType: "Role",
        entityId: role.id,
        beforeValue: { name: role.name },
      });
      return res.status(200).json(
        apiOk({
          id: role.id,
          name: role.name,
          description: role.description,
          isSystem: role.isSystem,
          permissions: role.permissions,
          userCount: 0,
          createdAt: role.createdAt.toISOString(),
          updatedAt: role.updatedAt.toISOString(),
        })
      );
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
