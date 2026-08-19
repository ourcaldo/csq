import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

// Prisma payload shape for an Agent with its AgentCapability overrides included.
// Used on both the server (typed query input) and the client (typed response).
export type AgentWithCapabilities = Prisma.AgentGetPayload<{
  include: { capabilities: true };
}>;

type ListResult = { items: AgentWithCapabilities[] };

// POST body for creating a new agent (PRD §15.2/§19). The agent is created in
// DRAFT; provisioning (OpenClaw cell + agent) happens on Deploy, not here.
const createSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(["CUSTOMER_SERVICE"]).optional(),
  instructions: z.string().max(8000).optional(),
});

// List the tenant's agents with their capability overrides. OWNER+STAFF can
// read (the capability matrix is owner-editable, but staff may view). POST
// (create) is OWNER-only.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ListResult | AgentWithCapabilities>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  if (req.method === "GET") {
    const items = await prisma.agent.findMany({
      where: { tenantId },
      include: { capabilities: true },
      orderBy: { createdAt: "asc" },
    });
    return res.status(200).json(apiOk({ items }));
  }

  if (req.method === "POST") {
    if (!requireRole(session, "OWNER")) {
      return respondError(
        res,
        "PERMISSION_DENIED",
        "Hanya owner yang dapat membuat agent."
      );
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    const agent = await prisma.agent.create({
      data: {
        tenantId,
        name: parsed.data.name,
        type: parsed.data.type ?? "CUSTOMER_SERVICE",
        instructions: parsed.data.instructions ?? null,
        status: "DRAFT",
      },
      include: { capabilities: true },
    });
    return res.status(201).json(apiOk(agent));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
