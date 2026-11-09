import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

// Team member management (PRD 16 FEA-5), OWNER-only, always tenant-scoped via
// the session. PUT either toggles the per-staff campaign permission (plan
// decision 2.2) or changes the role; demoting the last remaining OWNER is
// rejected. DELETE removes a member - never yourself, never the last owner.
// shortcut: a removed member's existing NextAuth JWT session stays valid
// until it expires (no token-version claim yet); add one in getAuthSession
// when session revocation is needed.

type PutResult =
  | { userId: string; canRunCampaigns: boolean }
  | { userId: string; role: "OWNER" | "STAFF" };
type DeleteResult = { userId: string; deleted: boolean };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<PutResult | DeleteResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (!requireRole(session, "OWNER")) {
      return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengatur izin tim.");
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
      if (target.role === "OWNER") {
        const owners = await prisma.user.count({ where: { tenantId, role: "OWNER" } });
        if (owners <= 1) {
          return respondError(res, "VALIDATION_ERROR", "Minimal harus ada satu owner.");
        }
      }
      await prisma.user.delete({ where: { id } });
      await logHuman({
        tenantId,
        action: "user.removed",
        entityType: "User",
        entityId: id,
        beforeValue: { email: target.email, name: target.name, role: target.role },
        afterValue: { removed: true },
      });
      return res.status(200).json(apiOk({ userId: id, deleted: true }));
    }

    if (req.method !== "PUT") {
      return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
    }

    const parsed = z
      .union([
        z.object({ canRunCampaigns: z.boolean() }),
        z.object({ role: z.enum(["OWNER", "STAFF"]) }),
      ])
      .safeParse(req.body);
    if (!parsed.success) {
      return respondError(
        res,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Input tidak valid."
      );
    }

    const target = await prisma.user.findFirst({ where: { id, tenantId } });
    if (!target) return respondError(res, "NOT_FOUND", "Pengguna tidak ditemukan.");

    if ("canRunCampaigns" in parsed.data) {
      if (target.role !== "STAFF") {
        return respondError(res, "VALIDATION_ERROR", "Izin kampanye hanya berlaku untuk staff.");
      }
      const updated = await prisma.user.update({
        where: { id },
        data: { canRunCampaigns: parsed.data.canRunCampaigns },
      });
      await logHuman({
        tenantId,
        action: "user.campaign_permission",
        entityType: "User",
        entityId: id,
        beforeValue: { canRunCampaigns: target.canRunCampaigns },
        afterValue: { canRunCampaigns: updated.canRunCampaigns },
      });
      return res
        .status(200)
        .json(apiOk({ userId: id, canRunCampaigns: updated.canRunCampaigns }));
    }

    // Role change (FEA-5): demoting the last remaining OWNER is rejected.
    const role = parsed.data.role;
    if (target.role === "OWNER" && role === "STAFF") {
      const owners = await prisma.user.count({ where: { tenantId, role: "OWNER" } });
      if (owners <= 1) {
        return respondError(res, "VALIDATION_ERROR", "Minimal harus ada satu owner.");
      }
    }
    const updated = await prisma.user.update({ where: { id }, data: { role } });
    await logHuman({
      tenantId,
      action: "user.role_change",
      entityType: "User",
      entityId: id,
      beforeValue: { role: target.role },
      afterValue: { role: updated.role },
    });
    return res.status(200).json(apiOk({ userId: id, role: updated.role }));
  });
}
