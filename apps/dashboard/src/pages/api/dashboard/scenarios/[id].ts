import type { NextApiRequest, NextApiResponse } from "next";
import type { Scenario } from "@prisma/client";
import { z } from "zod";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { logHuman } from "@/lib/audit";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import {
  scenarioGraphSchema,
  triggerTypeSchema,
  triggerConfigSchema,
} from "@/types/scenario";

// Single scenario: GET / PUT (edit fields) / DELETE. Activation and pause are
// separate endpoints ([id]/activate, [id]/pause) because they run graph
// validation and are OWNER-only. All writes are tenant-scoped via the session.

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  triggerType: triggerTypeSchema.optional(),
  triggerConfig: triggerConfigSchema.optional(),
  graph: scenarioGraphSchema.optional(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Scenario>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  const { id } = req.query;
  if (typeof id !== "string") {
    return respondError(res, "VALIDATION_ERROR", "ID scenario tidak valid.");
  }

  // Ensure the scenario belongs to this tenant on every method.
  const existing = await prisma.scenario.findFirst({ where: { id, tenantId } });
  if (!existing) {
    return respondError(res, "NOT_FOUND", "Scenario tidak ditemukan.");
  }

  if (req.method === "GET") {
    return res.status(200).json(apiOk(existing));
  }

  if (req.method === "PUT") {
    // Editing allowed for OWNER + STAFF (staff can build drafts).
    if (!requireRole(session, "OWNER", "STAFF")) {
      return respondError(res, "PERMISSION_DENIED", "Tidak ada izin mengubah scenario.");
    }
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Input tidak valid.");
    }
    const data = parsed.data;

    // Per-trigger-type required fields must survive the update: either this
    // update's triggerConfig carries them, or the existing one already does.
    const effectiveTriggerType = data.triggerType ?? existing.triggerType;
    const existingCfg = parseExistingConfig(existing.triggerConfig);
    const effectiveTagName = data.triggerConfig?.tagName ?? existingCfg?.tagName;
    if (effectiveTriggerType === "ON_TAG_ADDED" && !effectiveTagName) {
      return respondError(
        res,
        "VALIDATION_ERROR",
        "Trigger ON_TAG_ADDED memerlukan nama tag."
      );
    }
    const effectiveScheduleTime =
      data.triggerConfig?.scheduleTime ?? existingCfg?.scheduleTime;
    if (effectiveTriggerType === "ON_SCHEDULE" && !effectiveScheduleTime) {
      return respondError(
        res,
        "VALIDATION_ERROR",
        "Trigger ON_SCHEDULE memerlukan jam (triggerConfig.scheduleTime, HH:MM)."
      );
    }
    const effectiveNoReply =
      data.triggerConfig?.noReplyAfterMinutes ?? existingCfg?.noReplyAfterMinutes;
    if (effectiveTriggerType === "ON_NO_REPLY" && !effectiveNoReply) {
      return respondError(
        res,
        "VALIDATION_ERROR",
        "Trigger ON_NO_REPLY memerlukan durasi tanpa balasan (triggerConfig.noReplyAfterMinutes)."
      );
    }

    const updated = await prisma.scenario.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.triggerType !== undefined ? { triggerType: data.triggerType } : {}),
        ...(data.triggerConfig !== undefined ? { triggerConfig: data.triggerConfig } : {}),
        ...(data.graph !== undefined ? { graph: data.graph } : {}),
        version: { increment: 1 },
      },
    });
    await logHuman({
      tenantId,
      action: "scenario.update",
      entityType: "Scenario",
      entityId: id,
      afterValue: { name: updated.name },
    });
    return res.status(200).json(apiOk(updated));
  }

  if (req.method === "DELETE") {
    if (!requireRole(session, "OWNER")) {
      return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat menghapus scenario.");
    }
    await prisma.scenario.delete({ where: { id } });
    await logHuman({
      tenantId,
      action: "scenario.delete",
      entityType: "Scenario",
      entityId: id,
      beforeValue: { name: existing.name },
    });
    return res.status(200).json(apiOk(existing));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}

// Extract tagName from a stored triggerConfig Json without `as`.
function parseExistingConfig(raw: unknown): {
  tagName?: string;
  scheduleTime?: string;
  scheduleDays?: number[];
  noReplyAfterMinutes?: number;
} | undefined {
  const parsed = triggerConfigSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  return parsed.data;
}
