import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

// Team member management (PRD 16 FEA-5 + PRD 29), pengaturan.tim-gated,
// always tenant-scoped via the session. PUT assigns the member's role;
// the owner flag never changes here (exactly one isOwner per tenant, PRD 29
// section 5). DELETE removes a member - never yourself, never the last
// owner. Role changes apply on the target's next request (per-request
// permission load), so no session revocation is needed.
// shortcut: a removed member's existing NextAuth JWT session stays valid
// until it expires; the per-request permission load fails closed (no role =
// no permissions), so a removed member is effectively locked out.

type PutResult = { userId: string; roleId: string | null };
type DeleteResult = { userId: string; deleted: boolean };

const putSchema = z.object({
  roleId: z.string().uuid().nullable(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<PutResult | DeleteResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (!requirePermission(session, "pengaturan.tim")) {
      return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengatur tim.");
    }

    const { id } = req.query;
    if (typeof id !== "string") {
      return respondError(res, "VALIDATION_ERROR", "ID pengguna tidak valid.");
    }

    if (req.method === "DELETE") {
      if (id === session.user.id) {
        return respondError(res, "VALIDATION_ERROR", "Tidak dapat menghapus akun Anda sendiri.");
      }
      const target = await prisma.user.findFirst({ where: { id, tenantId } });
      if (!target) return respondError(res, "NOT_FOUND", "Pengguna tidak ditemukan.");
      if (target.isOwner) {
        const owners = await prisma.user.count({ where: { tenantId, isOwner: true } });
        if (owners <= 1) {
          return respondError(res, "VALIDATION_ERROR", "Minimal harus ada satu owner.");
        }
      }
      await prisma.user.delete({ where: { id } });
      await logHuman({
        actorEmail: session.user.email ?? undefined,
        tenantId,
        action: "user.removed",
        entityType: "User",
        entityId: id,
        beforeValue: { email: target.email, name: target.name, roleId: target.roleId },
        afterValue: { removed: true },
      });
      return res.status(200).json(apiOk({ userId: id, deleted: true }));
    }

    if (req.method !== "PUT") {
      return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
    }

    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", "Input tidak valid.");
    }

    // PRD 29 section 7: a user can never edit their own role.
    if (id === session.user.id) {
      return respondError(res, "VALIDATION_ERROR", "Tidak dapat mengubah peran Anda sendiri.");
    }
    const target = await prisma.user.findFirst({ where: { id, tenantId } });
    if (!target) return respondError(res, "NOT_FOUND", "Pengguna tidak ditemukan.");
    if (target.isOwner) {
      return respondError(res, "VALIDATION_ERROR", "Peran pemilik tidak dapat diubah.");
    }

    // The chosen role must belong to this tenant.
    if (parsed.data.roleId) {
      const role = await prisma.role.findFirst({
        where: { id: parsed.data.roleId, tenantId },
        select: { id: true },
      });
      if (!role) return respondError(res, "VALIDATION_ERROR", "Peran tidak ditemukan.");
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { roleId: parsed.data.roleId },
      select: { roleId: true },
    });
    await logHuman({
      actorEmail: session.user.email ?? undefined,
      tenantId,
      action: "user.role_change",
      entityType: "User",
      entityId: id,
      beforeValue: { roleId: target.roleId },
      afterValue: { roleId: updated.roleId },
    });
    return res.status(200).json(apiOk({ userId: id, roleId: updated.roleId }));
  });
}
