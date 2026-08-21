import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireRole } from "@/lib/auth";
import { requireTenant, respondError, strQuery } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import prisma from "@/lib/db";
import type { StageKind } from "@prisma/client";

// PUT  /api/dashboard/pipeline/stages/[id] — update name/order/winProbability/
// expectedDays/kind. Enforces one OPENING / one WON / one LOST per pipeline.
// DELETE /api/dashboard/pipeline/stages/[id] — remove a stage. Rejects deleting
// the OPENING/WON/LOST stages (a pipeline must keep one of each), and rejects
// deleting a stage that still has deals on it (reassign those first).

const stageUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  order: z.number().int().min(0).optional(),
  winProbability: z.number().min(0).max(1).nullable().optional(),
  expectedDays: z.number().int().min(0).nullable().optional(),
  kind: z.enum(["OPENING", "WON", "LOST", "NORMAL"]).optional(),
});

type StageResult = {
  id: string;
  name: string;
  order: number;
  winProbability: number | null;
  expectedDays: number | null;
  kind: StageKind;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<StageResult | { deleted: boolean }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER", "STAFF")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner/staff yang dapat mengelola tahap.");
  }
  const tenantId = requireTenant(session);
  const id = strQuery(req.query, "id");
  if (!id) return respondError(res, "VALIDATION_ERROR", "ID tahap tidak valid.");

  const stage = await prisma.stage.findFirst({ where: { id, tenantId } });
  if (!stage) return respondError(res, "NOT_FOUND", "Tahap tidak ditemukan.");

  if (req.method === "PUT") {
    const parsed = stageUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    const { name, order, winProbability, expectedDays, kind } = parsed.data;

    // Enforce one OPENING / one WON / one LOST per pipeline when changing kind.
    if (kind && kind !== "NORMAL" && kind !== stage.kind) {
      const clash = await prisma.stage.count({
        where: { pipelineId: stage.pipelineId, kind, id: { not: id } },
      });
      if (clash > 0) {
        return respondError(
          res,
          "VALIDATION_ERROR",
          `Tahap dengan peran "${kind}" sudah ada. Hanya boleh satu per pipeline.`
        );
      }
    }

    // Reject removing the required OPENING/WON/LOST by clearing their kind.
    const newKind = kind ?? stage.kind;
    if (stage.kind !== "NORMAL" && newKind === "NORMAL") {
      return respondError(
        res,
        "VALIDATION_ERROR",
        `Tahap "${stage.name}" berperan "${stage.kind}" dan wajib ada; tidak bisa diubah ke NORMAL.`
      );
    }

    const updated = await prisma.stage.update({
      where: { id },
      data: {
        name: name ?? undefined,
        order: order ?? undefined,
        winProbability: winProbability ?? undefined,
        expectedDays: expectedDays ?? undefined,
        kind: kind ?? undefined,
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
    return res.status(200).json(apiOk(updated));
  }

  if (req.method === "DELETE") {
    // Can't delete the required OPENING/WON/LOST stages.
    if (stage.kind !== "NORMAL") {
      return respondError(
        res,
        "VALIDATION_ERROR",
        `Tahap "${stage.name}" berperan "${stage.kind}" dan wajib ada; tidak bisa dihapus.`
      );
    }
    // Can't delete a stage that still has deals on it — reassign them first.
    const dealsOnStage = await prisma.deal.count({
      where: { stageId: id, tenantId },
    });
    if (dealsOnStage > 0) {
      return respondError(
        res,
        "VALIDATION_ERROR",
        `Masih ada ${dealsOnStage} deal di tahap "${stage.name}". Pindahkan dulu sebelum menghapus tahap.`
      );
    }
    await prisma.stage.delete({ where: { id } });
    return res.status(200).json(apiOk({ deleted: true }));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
