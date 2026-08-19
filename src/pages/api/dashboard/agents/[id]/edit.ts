import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { logHuman } from "@/lib/audit";
import { requireTenant, respondError, strQuery } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

// Edit an agent's persona: name and/or instructions (plan 6.6, gap C).
// OWNER-only, tenant-scoped. Zod-validated at the boundary; only provided
// fields are updated. Audited (before/after) via logHuman so persona changes
// are traceable. No `as` casts — the parsed shape drives the Prisma write.

const editSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  instructions: z.string().max(8000).nullable().optional(),
});

export type EditResult = {
  id: string;
  name: string;
  instructions: string | null;
  updatedAt: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<EditResult>>
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
      "Hanya owner yang dapat mengubah agent."
    );
  }
  const tenantId = requireTenant(session);

  const id = strQuery(req.query, "id");
  if (!id) return respondError(res, "VALIDATION_ERROR", "ID agent tidak valid.");

  const parsed = editSchema.safeParse(req.body);
  if (!parsed.success) {
    return respondError(res, "VALIDATION_ERROR", parsed.error.message);
  }

  const agent = await prisma.agent.findFirst({ where: { id, tenantId } });
  if (!agent) return respondError(res, "NOT_FOUND", "Agent tidak ditemukan.");

  // Build the update payload from only the fields actually provided, so a
  // caller can patch name without touching instructions (and vice versa).
  const data: { name?: string; instructions?: string | null } = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.instructions !== undefined) {
    data.instructions =
      parsed.data.instructions === null ? null : parsed.data.instructions;
  }

  const before = {
    name: agent.name,
    instructions: agent.instructions,
  };

  const updated = await prisma.agent.update({
    where: { id: agent.id },
    data,
    select: { id: true, name: true, instructions: true, updatedAt: true },
  });

  await logHuman({
    tenantId,
    action: "agent.edit",
    entityType: "Agent",
    entityId: agent.id,
    beforeValue: before,
    afterValue: { name: updated.name, instructions: updated.instructions },
  });

  return res.status(200).json(
    apiOk({
      id: updated.id,
      name: updated.name,
      instructions: updated.instructions,
      updatedAt: updated.updatedAt.toISOString(),
    })
  );
}
