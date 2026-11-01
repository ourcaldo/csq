import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { logHuman } from "@/lib/audit";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

// Per-staff campaign permission toggle (plan decision 2.2). OWNER-only. Only a
// STAFF member of the owner's own tenant can be toggled - an OWNER's access
// comes from the role and is not configurable.

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ userId: string; canRunCampaigns: boolean }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengatur izin tim.");
  }

  const { id } = req.query;
  if (typeof id !== "string") {
    return respondError(res, "VALIDATION_ERROR", "ID pengguna tidak valid.");
  }

  if (req.method !== "PUT") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const parsed = z.object({ canRunCampaigns: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    return respondError(res, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Input tidak valid.");
  }

  const target = await prisma.user.findFirst({ where: { id, tenantId } });
  if (!target) return respondError(res, "NOT_FOUND", "Pengguna tidak ditemukan.");
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
