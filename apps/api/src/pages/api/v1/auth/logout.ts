import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { withSystemContext } from "@csq/core/lib/tenant-context";
import { assignRequestId } from "@csq/core/lib/request-id";
import { hashRefreshToken } from "@csq/core/lib/refresh-tokens";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { refreshTokenRequestSchema, type LogoutResult } from "@/lib/api-contract";

// POST /api/v1/auth/logout - revoke a refresh token (PRD 23C Phase 8).
// Idempotent and always 200: the response must not reveal whether the token
// existed.

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<LogoutResult>>
) {
  assignRequestId(req, res);
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));
  }
  const parsed = refreshTokenRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(apiError("VALIDATION_ERROR", "Payload tidak valid."));
  }
  // Hash lookup crosses tenants: bypass context (PRD 16 SEC-1).
  await withSystemContext(async () => {
    await prisma.refreshToken
      .updateMany({
        where: { tokenHash: hashRefreshToken(parsed.data.refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => undefined);
  });
  return res.status(200).json(apiOk({ revoked: true }));
}
