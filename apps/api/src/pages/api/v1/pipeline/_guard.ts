import type { NextApiRequest, NextApiResponse } from "next";
import { requireApiAuth, type ApiAuth } from "@csq/core/lib/api-auth";
import { hasPermission, type PermissionKey } from "@csq/core/lib/permissions-catalog";
import { checkRateLimit } from "@csq/core/lib/rate-limit";
import { getTenantEntitlements } from "@csq/core/lib/entitlements";
import { apiError } from "@csq/core/types/api";
import type { PlanFeature } from "@csq/core/types/entitlements";

// Shared guard for /api/v1 pipeline routes (PRD 25): bearer auth, service
// tokens rejected, pipeline feature gate. PRD 29 section 8 amendment: a
// JWT_USER caller must also hold the route's catalog key (pipeline.lihat for
// reads, pipeline.kelola for writes) - tenant API keys keep their existing
// integration contract. Returns the tenant-bound auth context or null
// (response already sent).

export type TenantAuth = Extract<ApiAuth, { kind: "API_KEY" | "JWT_USER" }>;

export async function requireTenantFeature(
  req: NextApiRequest,
  res: NextApiResponse,
  feature: PlanFeature,
  scope: string,
  requiredPermission: PermissionKey
): Promise<TenantAuth | null> {
  const auth = await requireApiAuth(req);
  if (!auth) {
    res.setHeader("WWW-Authenticate", "Bearer");
    res.status(401).json(apiError("UNAUTHORIZED", "API key required"));
    return null;
  }
  if (auth.kind === "SERVICE") {
    res
      .status(403)
      .json(apiError("PERMISSION_DENIED", "Service tokens cannot manage tenant pipelines"));
    return null;
  }
  if (auth.kind === "JWT_USER" && !hasPermission(auth, requiredPermission)) {
    res
      .status(403)
      .json(apiError("PERMISSION_DENIED", `Role lacks ${requiredPermission}`));
    return null;
  }
  const credentialId = auth.kind === "API_KEY" ? auth.keyId : auth.userId;
  if (!checkRateLimit(`${scope}:${credentialId}`, 60, 60_000)) {
    res.status(429).json(apiError("RATE_LIMITED", "Too many requests"));
    return null;
  }
  const entitlements = await getTenantEntitlements(auth.tenantId);
  if (!entitlements.features.includes(feature)) {
    res
      .status(403)
      .json(
        apiError(
          "FEATURE_DISABLED",
          `The ${feature} feature is not on the tenant's plan (${entitlements.planName ?? "tenant"}).`
        )
      );
    return null;
  }
  return auth;
}
