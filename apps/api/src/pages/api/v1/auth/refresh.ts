import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { withSystemContext } from "@csq/core/lib/tenant-context";
import { assignRequestId } from "@csq/core/lib/request-id";
import { checkRateLimit } from "@csq/core/lib/rate-limit";
import { signAccessToken, ACCESS_TOKEN_TTL_SECONDS } from "@csq/core/lib/api-jwt";
import {
  generateRefreshToken,
  hashRefreshToken,
  REFRESH_TOKEN_TTL_MS,
} from "@csq/core/lib/refresh-tokens";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { refreshTokenRequestSchema, type TokenPair } from "@/lib/api-contract";

// POST /api/v1/auth/refresh - rotate a refresh token for a fresh pair
// (PRD 23C Phase 8). The presented token is ALWAYS revoked - replaying a
// used refresh token yields 401 (rotation detects theft of the cookie jar).

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<TokenPair>>
) {
  assignRequestId(req, res);
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));
  }
  const ipRaw = req.headers["x-forwarded-for"];
  const ip = ((Array.isArray(ipRaw) ? ipRaw[0] : ipRaw) ?? "unknown")
    .split(",")[0]
    .trim();
  if (!checkRateLimit(`refresh:${ip}`, 20, 60_000)) {
    return res.status(429).json(apiError("RATE_LIMITED", "Terlalu banyak percobaan."));
  }

  const parsed = refreshTokenRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(apiError("VALIDATION_ERROR", "Payload tidak valid."));
  }

  // Token-hash lookups cross tenants: bypass context (PRD 16 SEC-1).
  return withSystemContext(async () => {
    const row = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(parsed.data.refreshToken) },
    });
    if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) {
      return res.status(401).json(apiError("UNAUTHORIZED", "Refresh token tidak valid."));
    }
    const user = await prisma.user.findUnique({ where: { id: row.userId } });
    if (!user || !user.tenantId) {
      return res.status(401).json(apiError("UNAUTHORIZED", "Refresh token tidak valid."));
    }
    // SEC-4 (PRD 16): a suspended tenant is locked out with a distinct code.
    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { status: true },
    });
    if (tenant?.status === "SUSPENDED") {
      return res
        .status(403)
        .json(apiError("TENANT_SUSPENDED", "Tenant dinonaktifkan. Hubungi operator."));
    }

    // Rotate: the presented token dies, a new one is born in the same action.
    await prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });
    const refresh = generateRefreshToken();
    await prisma.refreshToken.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        tokenHash: refresh.hash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    const accessToken = await signAccessToken({
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });
    return res.status(200).json(
      apiOk({
        accessToken,
        refreshToken: refresh.token,
        tokenType: "Bearer",
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      })
    );
  });
}
