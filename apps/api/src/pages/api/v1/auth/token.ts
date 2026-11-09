import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { hashPassword, verifyPassword } from "@csq/core/lib/password";
import { assignRequestId } from "@csq/core/lib/request-id";
import { checkRateLimit } from "@csq/core/lib/rate-limit";
import { signAccessToken, ACCESS_TOKEN_TTL_SECONDS } from "@csq/core/lib/api-jwt";
import {
  generateRefreshToken,
  REFRESH_TOKEN_TTL_MS,
} from "@csq/core/lib/refresh-tokens";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { logAction } from "@csq/core/lib/audit";
import { authTokenRequestSchema, type TokenPair } from "@/lib/api-contract";

// POST /api/v1/auth/token - the mobile realm's credential exchange (PRD
// 23C Phase 8): email + password -> short-lived access JWT + opaque refresh
// token. Hard rate limit per IP (brute-force guard). Timing-equalized: an
// unknown email still pays the bcrypt cost before being rejected.

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
  if (!checkRateLimit(`auth:${ip}`, 5, 60_000)) {
    return res.status(429).json(apiError("RATE_LIMITED", "Terlalu banyak percobaan. Coba lagi sebentar."));
  }

  const parsed = authTokenRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload tidak valid."));
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  // Unknown email still burns a bcrypt round - the response time must not
  // reveal whether the account exists.
  const passwordOk = await verifyPassword(
    parsed.data.password,
    user?.passwordHash ?? (await hashPassword(parsed.data.password))
  );
  if (!user || !passwordOk) {
    return res.status(401).json(apiError("UNAUTHORIZED", "Email atau password salah."));
  }
  if (!user.tenantId) {
    return res.status(403).json(apiError("PERMISSION_DENIED", "Akun tidak terhubung ke tenant."));
  }

  const accessToken = await signAccessToken({
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
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
  await logAction({
    tenantId: user.tenantId,
    agentId: null,
    action: "user.api_token_issued",
    entityType: "User",
    entityId: user.id,
    approvalStatus: "NONE",
    customerPhone: undefined,
    afterValue: { email: user.email },
  });

  return res.status(200).json(
    apiOk({
      accessToken,
      refreshToken: refresh.token,
      tokenType: "Bearer",
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    })
  );
}
