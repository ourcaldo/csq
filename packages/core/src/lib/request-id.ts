import { randomUUID } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";

// Request correlation for /api/v1 (PRD 23C Phase 7: error-request-id).
// Echoes a caller-supplied X-Request-Id when sane, otherwise mints one, and
// always sets it on the response so a support conversation can reference
// the exact request.

export function assignRequestId(
  req: NextApiRequest,
  res: NextApiResponse
): string {
  const raw = req.headers["x-request-id"];
  const existing = Array.isArray(raw) ? raw[0] : raw;
  const id = existing && existing.length <= 64 ? existing : randomUUID();
  res.setHeader("X-Request-Id", id);
  return id;
}
