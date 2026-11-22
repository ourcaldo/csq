import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { grantCapability } from "@csq/core/lib/permissions";
import { requireTenant, respondError, strQuery } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

// Body schema for a capability override update. `tool` is the registry tool
// name (e.g. "product.update"); `allowed` gates the tool; `requiresApproval`
// forces owner approval before the agent's write is applied.
const capabilitySchema = z.object({
  tool: z.string().min(1),
  allowed: z.boolean(),
  requiresApproval: z.boolean(),
});

type CapabilitiesResult = { ok: true };

// PUT (OWNER-only): set an explicit AgentCapability override for an agent.
// Tenant-scoped via requireTenant; the agent is verified to belong to the
// tenant before grantCapability is called.
// DELETE (OWNER-only): remove ALL overrides for the agent so every tool
// reverts to its registry defaultPermission (template 2026-11-22 "Pulihkan
// Default Registry").
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<CapabilitiesResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(
      res,
      "PERMISSION_DENIED",
      "Hanya owner yang dapat mengubah kapabilitas agent."
    );
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const id = strQuery(req.query, "id");
    if (!id) return respondError(res, "VALIDATION_ERROR", "ID agent tidak valid.");

    // Verify the agent belongs to this tenant before mutating capabilities.
    const agent = await prisma.agent.findFirst({ where: { id, tenantId } });
    if (!agent) return respondError(res, "NOT_FOUND", "Agent tidak ditemukan.");

    if (req.method === "DELETE") {
      const removed = await prisma.agentCapability.deleteMany({
        where: { tenantId, agentId: agent.id },
      });
      await logHuman({
        tenantId,
        action: "agent.capability.reset",
        entityType: "AgentCapability",
        entityId: agent.id,
        beforeValue: { removed: removed.count },
        afterValue: { note: "semua override dihapus, kembali ke default registry" },
      });
      return res.status(200).json(apiOk({ ok: true }));
    }

    if (req.method !== "PUT") {
      return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
    }

    const parsed = capabilitySchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    const { tool, allowed, requiresApproval } = parsed.data;

    const before = await prisma.agentCapability.findUnique({
      where: { agentId_tool: { agentId: agent.id, tool } },
    });

    await grantCapability(tenantId, agent.id, tool, allowed, requiresApproval);

    await logHuman({
      tenantId,
      action: "agent.capability.update",
      entityType: "AgentCapability",
      entityId: `${agent.id}:${tool}`,
      beforeValue: before ?? undefined,
      afterValue: { allowed, requiresApproval },
    });

    return res.status(200).json(apiOk({ ok: true }));
  });
}
