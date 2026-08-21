import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireRole } from "@/lib/auth";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { getOrCreatePipeline } from "@/lib/pipeline";
import prisma from "@/lib/db";
import type { StageKind } from "@prisma/client";

// POST /api/dashboard/pipeline/stages — OWNER/STAFF. Create a stage in the
// tenant's pipeline. Enforces one OPENING / one WON / one LOST per pipeline.
type StageResult = {
  id: string;
  name: string;
  order: number;
  winProbability: number | null;
  expectedDays: number | null;
  kind: StageKind;
};

const stageCreateSchema = z.object({
  name: z.string().min(1).max(80),
  order: z.number().int().min(0).optional(),
  winProbability: z.number().min(0).max(1).optional(),
  expectedDays: z.number().int().min(0).nullable().optional(),
  kind: z.enum(["OPENING", "WON", "LOST", "NORMAL"]),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<StageResult>>
) {
  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER", "STAFF")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner/staff yang dapat mengelola tahap.");
  }
  const tenantId = requireTenant(session);

  const parsed = stageCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return respondError(res, "VALIDATION_ERROR", parsed.error.message);
  }
  const { name, order, winProbability, expectedDays, kind } = parsed.data;

  const pipeline = await getOrCreatePipeline(tenantId);

  // Enforce one OPENING / one WON / one LOST per pipeline.
  if (kind !== "NORMAL") {
    const existing = await prisma.stage.count({
      where: { pipelineId: pipeline.id, kind },
    });
    if (existing > 0) {
      return respondError(
        res,
        "VALIDATION_ERROR",
        `Tahap dengan peran "${kind}" sudah ada. Hanya boleh satu per pipeline.`
      );
    }
  }

  // Default order to the end of the pipeline.
  const maxOrder = await prisma.stage.aggregate({
    where: { pipelineId: pipeline.id },
    _max: { order: true },
  });
  const nextOrder = order ?? (maxOrder._max.order ?? 0) + 1;

  const stage = await prisma.stage.create({
    data: {
      tenantId,
      pipelineId: pipeline.id,
      name,
      order: nextOrder,
      winProbability: winProbability ?? null,
      expectedDays: expectedDays ?? null,
      kind,
    },
    select: {
      id: true,
      name: true,
      order: true,
      winProbability: true,
      expectedDays: true,
      kind: true,
    },
  });
  return res.status(201).json(apiOk(stage));
}
