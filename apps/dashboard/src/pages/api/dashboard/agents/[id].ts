import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

// FEA-4 (PRD 16): delete an agent. OWNER-only, DRAFT or PAUSED only - an
// ACTIVE agent must be paused first so a live conversation never loses its
// agent mid-flight. Capabilities and memories cascade; orders, conversations,
// messages, and audit rows keep history via their SetNull agent references.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ id: string }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (!requireRole(session, "OWNER")) {
      return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat menghapus agent.");
    }

    const { id } = req.query;
    if (typeof id !== "string") {
      return respondError(res, "VALIDATION_ERROR", "ID agent tidak valid.");
    }

    if (req.method !== "DELETE") {
      return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
    }

    const agent = await prisma.agent.findFirst({ where: { id, tenantId } });
    if (!agent) return respondError(res, "NOT_FOUND", "Agent tidak ditemukan.");
    if (agent.status === "ACTIVE") {
      return respondError(
        res,
        "VALIDATION_ERROR",
        "Agent aktif harus dijeda dulu sebelum dihapus."
      );
    }

    await prisma.agent.delete({ where: { id } });
    await logHuman({
      tenantId,
      action: "agent.delete",
      entityType: "Agent",
      entityId: id,
      beforeValue: agent,
    });
    return res.status(200).json(apiOk({ id }));
  });
}
