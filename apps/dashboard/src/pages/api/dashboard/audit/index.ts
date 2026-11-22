import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

// Tenant configuration audit log (PRD 28 follow-up): the tenant's own
// AuditLog rows, newest first. OWNER-only.
// Audit run-3 (audit.actor-misattribution): the actor comes from the row -
// the agent relation for AI actions, the NEW actorEmail snapshot for human
// actions. Legacy rows (pre-backfill, actorEmail null) render "Pengguna"
// instead of being misattributed to the viewing owner.

type AuditRow = {
  id: string;
  action: string;
  actorName: string | null;
  createdAt: string;
  entityType: string;
  entityId: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ items: AuditRow[] }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat melihat log audit.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method !== "GET") {
      return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
    }

    const rows = await prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        action: true,
        createdAt: true,
        entityType: true,
        entityId: true,
        agent: { select: { name: true } },
        actorEmail: true,
      },
    });

    const items: AuditRow[] = rows.map((r) => ({
      id: r.id,
      action: r.action,
      // Agent rows name the agent; human rows use the recorded actor email;
      // legacy human rows have no recorded actor - "Pengguna" (NOT the
      // viewer: the audit trail must never falsify attribution).
      actorName: r.agent?.name ?? r.actorEmail ?? "Pengguna",
      createdAt: r.createdAt.toISOString(),
      entityType: r.entityType,
      entityId: r.entityId,
    }));
    return res.status(200).json(apiOk({ items }));
  });
}
