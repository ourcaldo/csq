import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError, strQuery } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

// Archive a channel (PRD 15): soft-hide only, data fully retained. Allowed
// only while DISCONNECTED - an archivable channel frees a plan seat because
// the limit counts CONNECTED channels. No hard delete exists: it would
// cascade conversations, messages and campaigns.
export type ArchiveResult = { id: string; archivedAt: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ArchiveResult>>
) {
  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengarsipkan channel.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const id = strQuery(req.query, "id");
    if (!id) return respondError(res, "VALIDATION_ERROR", "ID channel tidak valid.");

    const channel = await prisma.channel.findFirst({ where: { id, tenantId } });
    if (!channel) return respondError(res, "NOT_FOUND", "Channel tidak ditemukan.");
    if (channel.status === "CONNECTED") {
      return respondError(
        res,
        "VALIDATION_ERROR",
        "Putuskan saluran ini sebelum mengarsipkan."
      );
    }

    const updated = await prisma.channel.update({
      where: { id: channel.id },
      data: { archivedAt: new Date() },
      select: { id: true, archivedAt: true },
    });

    return res.status(200).json(
      apiOk({
        id: updated.id,
        archivedAt: (updated.archivedAt ?? new Date()).toISOString(),
      })
    );
  });
}
