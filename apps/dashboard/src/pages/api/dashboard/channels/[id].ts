// PATCH (OWNER-only): assign or unassign an agent to a channel
// (template 2026-11-22: the Agent form's "Saluran Terhubung" select).
// agentId: null detaches. Tenant-scoped; the agent must belong to the same
// tenant before the link is written.
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { requireTenant, respondError, strQuery } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

const patchSchema = z.object({
  agentId: z.string().uuid().nullable(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ id: string; agentId: string | null }>>
) {
  if (req.method !== "PATCH") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengatur saluran agent.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const id = strQuery(req.query, "id");
    if (!id) return respondError(res, "VALIDATION_ERROR", "ID saluran tidak valid.");

    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }

    const channel = await prisma.channel.findFirst({ where: { id, tenantId } });
    if (!channel) return respondError(res, "NOT_FOUND", "Saluran tidak ditemukan.");

    if (parsed.data.agentId) {
      const agent = await prisma.agent.findFirst({
        where: { id: parsed.data.agentId, tenantId },
      });
      if (!agent) return respondError(res, "NOT_FOUND", "Agent tidak ditemukan.");
    }

    const updated = await prisma.channel.update({
      where: { id: channel.id },
      data: { agentId: parsed.data.agentId },
      select: { id: true, agentId: true },
    });

    await logHuman({
      tenantId,
      action: "channel.agent_assign",
      entityType: "Channel",
      entityId: channel.id,
      beforeValue: { agentId: channel.agentId },
      afterValue: { agentId: updated.agentId },
    });

    return res.status(200).json(apiOk(updated));
  });
}
