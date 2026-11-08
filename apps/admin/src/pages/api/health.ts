import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";

// Liveness + DB check for Render's health probe. Unauthenticated by design
// (same contract as the dashboard's). The admin process runs NO scheduler
// and holds NO sockets (PRD 13) - it is a pure UI + BFF.
type Health = { status: "ok"; db: "up" } | { status: "ok"; db: "down" };

export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Health>>
) {
  if (_req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json(apiOk({ status: "ok", db: "up" }));
  } catch {
    return res.status(503).json(apiError("INTERNAL_ERROR", "database unreachable"));
  }
}
