import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { logHuman } from "@/lib/audit";
import { grantCapability } from "@/lib/permissions";
import { requireTenant, respondError, strQuery } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

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
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<CapabilitiesResult>>
) {
  if (req.method !== "PUT") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

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

  const id = strQuery(req.query, "id");
  if (!id) return respondError(res, "VALIDATION_ERROR", "ID agent tidak valid.");

  const parsed = capabilitySchema.safeParse(req.body);
  if (!parsed.success) {
    return respondError(res, "VALIDATION_ERROR", parsed.error.message);
  }
  const { tool, allowed, requiresApproval } = parsed.data;

  // Verify the agent belongs to this tenant before mutating capabilities.
  const agent = await prisma.agent.findFirst({ where: { id, tenantId } });
  if (!agent) return respondError(res, "NOT_FOUND", "Agent tidak ditemukan.");

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
}
