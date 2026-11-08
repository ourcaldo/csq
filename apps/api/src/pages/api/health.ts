import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { registerScenarioEngine } from "@csq/core/lib/scenario-engine";

// Liveness + DB connectivity for Render's health check. Also the boot hook
// for this process's event-bus subscription: the Meta webhook lives in this
// service (PRD 23C Phase 7), so inbound-event scenario triggers fire here -
// their Baileys sends flow through the worker outbox, Cloud API sends are
// stateless HTTP.
type Health = { status: "ok"; db: "up" } | { status: "ok"; db: "down" };

export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Health>>
) {
  if (_req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json(apiError("VALIDATION_ERROR", "Method not allowed"));
  }

  registerScenarioEngine();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json(apiOk({ status: "ok", db: "up" }));
  } catch {
    return res.status(503).json(apiError("INTERNAL_ERROR", "database unreachable"));
  }
}
