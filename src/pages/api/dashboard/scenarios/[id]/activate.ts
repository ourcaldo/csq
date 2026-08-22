import type { NextApiRequest, NextApiResponse } from "next";
import type { Scenario } from "@prisma/client";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { logHuman } from "@/lib/audit";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { scenarioGraphSchema } from "@/types/scenario";
import { validateScenarioGraph } from "@/lib/scenario-validate";

// Activate a scenario (DRAFT/PAUSED → ACTIVE). OWNER-only. Runs full graph
// validation first: a malformed graph (cycle, dangling node, missing branch,
// no End) never goes live. Cloud API tenants also get a 24h-window warning
// when a Send sits behind Waits summing >= 24h (non-blocking — the runtime
// enforces the real check at send time).

type ActivateResult = { scenario: Scenario; warnings: string[] };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ActivateResult>>
) {
  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengaktifkan scenario.");
  }
  const tenantId = requireTenant(session);

  const { id } = req.query;
  if (typeof id !== "string") {
    return respondError(res, "VALIDATION_ERROR", "ID scenario tidak valid.");
  }

  const scenario = await prisma.scenario.findFirst({ where: { id, tenantId } });
  if (!scenario) {
    return respondError(res, "NOT_FOUND", "Scenario tidak ditemukan.");
  }

  const graphParsed = scenarioGraphSchema.safeParse(scenario.graph);
  if (!graphParsed.success) {
    return respondError(
      res,
      "VALIDATION_ERROR",
      "Graph tidak valid: " + graphParsed.error.issues.map((i) => i.message).join("; ")
    );
  }

  // Does the tenant have any Cloud API channel? That's the only channel where
  // the 24h window warning is relevant.
  const cloudApiChannel = await prisma.channel.findFirst({
    where: { tenantId, provider: "CLOUD_API" },
    select: { id: true },
  });

  const { errors, warnings } = validateScenarioGraph(graphParsed.data, {
    cloudApi: !!cloudApiChannel,
  });
  if (errors.length > 0) {
    return respondError(res, "VALIDATION_ERROR", errors.join(" "));
  }

  const activated = await prisma.scenario.update({
    where: { id },
    data: { status: "ACTIVE" },
  });
  await logHuman({
    tenantId,
    action: "scenario.activate",
    entityType: "Scenario",
    entityId: id,
    afterValue: { name: activated.name, warnings },
  });

  return res.status(200).json(apiOk({ scenario: activated, warnings }));
}
