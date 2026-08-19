import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/db";
import { apiError, apiOk, type ApiResponse } from "@/types/api";
import { startScheduler } from "@/services/scheduler";

// Liveness + DB connectivity check for the production compose healthcheck
// and load balancer probes. Unauthenticated by design. Also the boot hook:
// Render pings this path on startup (set Health Check Path = /api/health in
// the dashboard), and each ping starts the in-process scheduler (idempotent)
// — which reconnects CONNECTED Baileys channels and runs the keepalive
// heartbeat. This guarantees the WhatsApp socket is up on every boot without
// pulling baileys into the client bundle.
type Health = { status: "ok"; db: "up" } | { status: "ok"; db: "down" };

export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Health>>
) {
  if (_req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json(apiError("INTERNAL_ERROR", "Method not allowed"));
  }

  startScheduler();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json(apiOk({ status: "ok", db: "up" }));
  } catch {
    // App process is alive but the DB is unreachable — 503 so probes fail fast.
    return res.status(503).json(apiError("INTERNAL_ERROR", "database unreachable"));
  }
}
