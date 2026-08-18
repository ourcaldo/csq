import type { NextApiRequest, NextApiResponse } from "next";
import type { Prisma } from "@prisma/client";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

// Prisma payload shape for an Agent with its AgentCapability overrides included.
// Used on both the server (typed query input) and the client (typed response).
export type AgentWithCapabilities = Prisma.AgentGetPayload<{
  include: { capabilities: true };
}>;

type ListResult = { items: AgentWithCapabilities[] };

// List the tenant's agents with their capability overrides. OWNER+STAFF can
// read (the capability matrix is owner-editable, but staff may view it).
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ListResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  if (req.method !== "GET") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const items = await prisma.agent.findMany({
    where: { tenantId },
    include: { capabilities: true },
    orderBy: { createdAt: "asc" },
  });

  return res.status(200).json(apiOk({ items }));
}
