import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import prisma from "@csq/core/lib/db";
import { assignRequestId } from "@csq/core/lib/request-id";
import { hashRefreshToken } from "@csq/core/lib/refresh-tokens";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";

// POST /api/v1/auth/logout - revoke a refresh token (PRD 23C Phase 8).
// Idempotent and always 200: the response must not reveal whether the token
// existed.

const logoutSchema = z.object({ refreshToken: z.string().min(10).max(200) });

export type LogoutResult = { revoked: boolean };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<LogoutResult>>
) {
  assignRequestId(req, res);
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));
  }
  const parsed = logoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(apiError("VALIDATION_ERROR", "Payload tidak valid."));
  }
  await prisma.refreshToken
    .updateMany({
      where: { tokenHash: hashRefreshToken(parsed.data.refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    })
    .catch(() => undefined);
  return res.status(200).json(apiOk({ revoked: true }));
}
