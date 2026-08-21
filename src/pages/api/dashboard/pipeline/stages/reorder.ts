import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireRole } from "@/lib/auth";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import prisma from "@/lib/db";

// PUT /api/dashboard/pipeline/stages/reorder — OWNER/STAFF. Body:
// { order: string[] } — the stage ids in the desired order. Reassigns the
// `order` field of each stage to its index (1-based) in the array. All ids must
// belong to the tenant's pipeline.
const reorderSchema = z.object({
  order: z.array(z.string().uuid()).min(1),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ ok: boolean }>>
) {
  if (req.method !== "PUT") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER", "STAFF")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner/staff yang dapat mengelola tahap.");
  }
  const tenantId = requireTenant(session);

  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) {
    return respondError(res, "VALIDATION_ERROR", parsed.error.message);
  }
  const ids = parsed.data.order;

  // Verify all ids belong to the tenant in one query, then update each order.
  const stages = await prisma.stage.findMany({
    where: { tenantId, id: { in: ids } },
    select: { id: true },
  });
  if (stages.length !== ids.length) {
    return respondError(res, "VALIDATION_ERROR", "Beberapa ID tahap tidak valid.");
  }

  await prisma.$transaction(
    ids.map((stageId, i) =>
      prisma.stage.update({
        where: { id: stageId },
        data: { order: i + 1 },
      })
    )
  );
  return res.status(200).json(apiOk({ ok: true }));
}
