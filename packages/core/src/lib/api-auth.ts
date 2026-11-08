import type { NextApiRequest } from "next";
import prisma from "@csq/core/lib/db";
import { hashApiToken } from "@csq/core/lib/api-tokens";
import { verifyAccessToken } from "@csq/core/lib/api-jwt";

// Bearer-token auth for the /api/v1 surface (PRD 23C Phase 7). Two kinds:
// - SERVICE: platform-internal tokens from the API_SERVICE_TOKENS env
//   (comma-separated). Not tenant-bound - they may call non-tenant endpoints
//   only (today: the webhook-diag proxy the dashboard BFF uses).
// - API_KEY: tenant-bound keys from the ApiKey table. Required for anything
//   tenant-scoped (tool execution). lastUsedAt is refreshed best-effort.

export type ApiAuth =
  | { kind: "SERVICE" }
  | { kind: "API_KEY"; tenantId: string; keyId: string }
  | { kind: "JWT_USER"; userId: string; tenantId: string; role: string };

export function bearerToken(req: NextApiRequest): string | null {
  const raw = req.headers["authorization"];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

export async function requireApiAuth(req: NextApiRequest): Promise<ApiAuth | null> {
  const token = bearerToken(req);
  if (!token) return null;
  // Hash both sides before comparing - constant-shape comparison, and the
  // configured list never meets the raw token.
  const presented = hashApiToken(token);
  const services = (process.env.API_SERVICE_TOKENS ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => hashApiToken(t));
  if (services.includes(presented)) return { kind: "SERVICE" };
  const key = await prisma.apiKey.findUnique({
    where: { tokenHash: presented },
  });
  if (key && !key.revokedAt) {
    void prisma.apiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return { kind: "API_KEY", tenantId: key.tenantId, keyId: key.id };
  }
  // Phase 8: the mobile realm - a signed access JWT is a user-scoped
  // credential carrying its own tenantId.
  const jwt = await verifyAccessToken(token);
  if (jwt) return { kind: "JWT_USER", ...jwt };
  return null;
}
