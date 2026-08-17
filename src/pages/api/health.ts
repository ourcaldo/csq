import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/db";
import { apiError, apiOk, type ApiResponse } from "@/types/api";

// Liveness + DB connectivity check for the production compose healthcheck
// and load balancer probes. Unauthenticated by design.
type Health = { status: "ok"; db: "up" } | { status: "ok"; db: "down" };

export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Health>>
) {
  if (_req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json(apiError("INTERNAL_ERROR", "Method not allowed"));
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json(apiOk({ status: "ok", db: "up" }));
  } catch {
    // App process is alive but the DB is unreachable — 503 so probes fail fast.
    return res.status(503).json(apiError("INTERNAL_ERROR", "database unreachable"));
  }
}
