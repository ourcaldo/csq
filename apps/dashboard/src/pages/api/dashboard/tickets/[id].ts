import type { NextApiRequest, NextApiResponse } from "next";
import type { SupportTicket } from "@prisma/client";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

// FEA-3 (PRD 16): close (resolve) a support ticket. OWNER-only - STAFF can
// read tickets but not close them.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<SupportTicket>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (!requireRole(session, "OWNER")) {
      return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat menutup tiket.");
    }

    const { id } = req.query;
    if (typeof id !== "string") {
      return respondError(res, "VALIDATION_ERROR", "ID tiket tidak valid.");
    }

    if (req.method !== "POST") {
      return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
    }

    const ticket = await prisma.supportTicket.findFirst({ where: { id, tenantId } });
    if (!ticket) return respondError(res, "NOT_FOUND", "Tiket tidak ditemukan.");
    if (ticket.status === "RESOLVED") {
      return respondError(res, "VALIDATION_ERROR", "Tiket sudah ditutup.");
    }

    const resolved = await prisma.supportTicket.update({
      where: { id },
      data: {
        status: "RESOLVED",
        resolvedById: session.user.id,
        resolvedAt: new Date(),
      },
    });
    await logHuman({
      tenantId,
      action: "support.resolve_ticket",
      entityType: "SupportTicket",
      entityId: id,
      beforeValue: ticket,
      afterValue: resolved,
    });
    return res.status(200).json(apiOk(resolved));
  });
}
