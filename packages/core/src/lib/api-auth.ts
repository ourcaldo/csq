import type { NextApiRequest } from "next";
import prisma from "@csq/core/lib/db";
import { withSystemContext } from "@csq/core/lib/tenant-context";
import { hashApiToken } from "@csq/core/lib/api-tokens";
import { verifyAccessToken } from "@csq/core/lib/api-jwt";
import { loadUserRealm } from "@csq/core/lib/user-permissions";
import type { PermissionKey } from "@csq/core/lib/permissions-catalog";

// Bearer-token auth for the /api/v1 surface (PRD 23C Phase 7). Three kinds:
// - SERVICE: platform-internal tokens from the API_SERVICE_TOKENS env
//   (comma-separated). Not tenant-bound - they may call non-tenant endpoints
//   only (today: the webhook-diag proxy the dashboard BFF uses).
// - API_KEY: tenant-bound keys from the ApiKey table. Required for anything
//   tenant-scoped (tool execution). lastUsedAt is refreshed best-effort.
// - JWT_USER: a signed user access token (PRD 23C Phase 8). PRD 29 section 8
//   amendment (owner decision 2026-11-23, option A): the realm carries the
//   user's FRESH catalog permissions, loaded per request - consumers gate
//   JWT_USER calls with hasPermission exactly like the dashboard realm.

export type ApiAuth =
  | { kind: "SERVICE" }
  | { kind: "API_KEY"; tenantId: string; keyId: string; keyName: string }
  | {
      kind: "JWT_USER";
      userId: string;
      tenantId: string;
      isOwner: boolean;
      permissions: PermissionKey[];
    };

export function bearerToken(req: NextApiRequest): string | null {
  const raw = req.headers["authorization"];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

export async function requireApiAuth(req: NextApiRequest): Promise<ApiAuth | null> {
  // Key lookup crosses tenants (hashed-token join), so it runs in the bypass
  // context (PRD 16 SEC-1). A SUSPENDED tenant is locked out of the API
  // realm entirely (SEC-4): its keys and JWTs stop authenticating.
  return withSystemContext(async () => {
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
      if (await tenantSuspended(key.tenantId)) return null;
      void prisma.apiKey
        .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
      return { kind: "API_KEY", tenantId: key.tenantId, keyId: key.id, keyName: key.name };
    }
    // Phase 8: the user realm - a signed access JWT is a user-scoped
    // credential. PRD 29: load the user's fresh permissions per request
    // (option A); a deleted user or a tenant move kills the token
    // immediately - no 15-minute revocation lag for JWT_USER.
    const jwt = await verifyAccessToken(token);
    if (jwt) {
      if (await tenantSuspended(jwt.tenantId)) return null;
      const realm = await loadUserRealm(jwt.userId);
      if (!realm || realm.tenantId !== jwt.tenantId) return null;
      return {
        kind: "JWT_USER",
        userId: jwt.userId,
        tenantId: realm.tenantId,
        isOwner: realm.isOwner,
        permissions: realm.permissions,
      };
    }
    return null;
  });
}

async function tenantSuspended(tenantId: string): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { status: true },
  });
  return tenant?.status === "SUSPENDED";
}
