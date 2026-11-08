import type { NextApiRequest, NextApiResponse } from "next";
import type { Scenario } from "@prisma/client";
import { z } from "zod";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { logHuman } from "@/lib/audit";
import { paginate, requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import {
  scenarioGraphSchema,
  triggerTypeSchema,
  triggerConfigSchema,
  type ScenarioGraph,
  type TriggerConfig,
} from "@/types/scenario";

// Scenario list + create. Scenarios are tenant-scoped; tenantId always from
// the session, never the body. Staff can create drafts; activation is
// OWNER-only (handled in [id].ts). Every graph is Zod-parsed at this boundary.

type ListResult = {
  items: Scenario[];
  total: number;
  page: number;
  pageSize: number;
};

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  triggerType: triggerTypeSchema,
  triggerConfig: triggerConfigSchema.optional(),
  graph: scenarioGraphSchema.optional(),
});

// Build the default starting graph for a new scenario: a trigger wired to an
// end. The owner inserts Send/Wait/Condition/Tag nodes between them in the
// builder. Carries the trigger config so the trigger node matches the column.
function defaultGraph(
  triggerType: z.infer<typeof triggerTypeSchema>,
  triggerConfig?: TriggerConfig
): ScenarioGraph {
  return {
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 80, y: 200 },
        data: {
          triggerType,
          tagName: triggerConfig?.tagName,
          scheduleTime: triggerConfig?.scheduleTime,
          scheduleDays: triggerConfig?.scheduleDays,
          noReplyAfterMinutes: triggerConfig?.noReplyAfterMinutes,
        },
      },
      {
        id: "end-1",
        type: "end",
        position: { x: 620, y: 200 },
        data: {},
      },
    ],
    edges: [{ id: "e-trigger-end", source: "trigger-1", target: "end-1" }],
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Scenario | ListResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  if (req.method === "GET") {
    const { skip, take, page, pageSize } = paginate(req.query);
    const [items, total] = await Promise.all([
      prisma.scenario.findMany({
        where: { tenantId },
        skip,
        take,
        orderBy: { updatedAt: "desc" },
      }),
      prisma.scenario.count({ where: { tenantId } }),
    ]);
    return res.status(200).json(apiOk({ items, total, page, pageSize }));
  }

  if (req.method === "POST") {
    // Staff can draft; only OWNER activates. Creation allowed for both.
    if (!requireRole(session, "OWNER", "STAFF")) {
      return respondError(
        res,
        "PERMISSION_DENIED",
        "Hanya owner atau staff yang dapat membuat scenario."
      );
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Input tidak valid.");
    }
    const data = parsed.data;
    // Per-trigger-type required fields at creation.
    if (data.triggerType === "ON_TAG_ADDED" && !data.triggerConfig?.tagName) {
      return respondError(
        res,
        "VALIDATION_ERROR",
        "Trigger ON_TAG_ADDED memerlukan nama tag (triggerConfig.tagName)."
      );
    }
    if (data.triggerType === "ON_SCHEDULE" && !data.triggerConfig?.scheduleTime) {
      return respondError(
        res,
        "VALIDATION_ERROR",
        "Trigger ON_SCHEDULE memerlukan jam (triggerConfig.scheduleTime, HH:MM)."
      );
    }
    if (data.triggerType === "ON_NO_REPLY" && !data.triggerConfig?.noReplyAfterMinutes) {
      return respondError(
        res,
        "VALIDATION_ERROR",
        "Trigger ON_NO_REPLY memerlukan durasi tanpa balasan (triggerConfig.noReplyAfterMinutes)."
      );
    }

    const scenario = await prisma.scenario.create({
      data: {
        tenantId,
        name: data.name,
        description: data.description,
        status: "DRAFT",
        triggerType: data.triggerType,
        triggerConfig: data.triggerConfig ?? {},
        graph: data.graph ?? defaultGraph(data.triggerType, data.triggerConfig),
      },
    });
    await logHuman({
      tenantId,
      action: "scenario.create",
      entityType: "Scenario",
      entityId: scenario.id,
      afterValue: { name: scenario.name, triggerType: scenario.triggerType },
    });
    return res.status(201).json(apiOk(scenario));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
