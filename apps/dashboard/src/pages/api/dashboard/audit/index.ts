import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

// Tenant configuration audit log (PRD 28 follow-up): the tenant's own
// AuditLog rows, newest first. OWNER-only. The schema has no per-row human
// actor or IP (logHuman writes agentId: null) - the actor is rendered from
// the agent relation when present, else the acting session user (the only
// role that can reach this page is OWNER).

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
      },
    });

    const items: AuditRow[] = rows.map((r) => ({
      id: r.id,
      action: r.action,
      // agentId null = a human action (logHuman) - on this OWNER-only page
      // that resolves to the signed-in operator.
      actorName: r.agent?.name ?? session.user.name ?? session.user.email ?? null,
      createdAt: r.createdAt.toISOString(),
      entityType: r.entityType,
      entityId: r.entityId,
    }));
    return res.status(200).json(apiOk({ items }));
  });
}
