import prisma from "@csq/core/lib/db";
import { withSystemContext } from "@csq/core/lib/tenant-context";
import {
  ALL_KEYS,
  expandPermissions,
  type PermissionKey,
} from "@csq/core/lib/permissions-catalog";

// PRD 29 section 8 amendment (owner decision 2026-11-23, option A): the
// /api/v1 user-token realm enforces the same catalog permissions as the
// dashboard realm. This loader is the API realm's per-request permission
// resolution - one system-context query, fresh on every request, so role
// changes and user deletion take effect immediately (no stale-token
// privilege retention; unlike the 15-minute JWT TTL, revocation is now
// instant for the user realm).

export type UserRealm = {
  tenantId: string;
  isOwner: boolean;
  permissions: PermissionKey[];
};

// Returns null when the user no longer exists - callers must treat that as
// unauthenticated (fail closed).
export async function loadUserRealm(userId: string): Promise<UserRealm | null> {
  const user = await withSystemContext(async () =>
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        tenantId: true,
        isOwner: true,
        role: { select: { permissions: true } },
      },
    })
  );
  if (!user) return null;
  return {
    tenantId: user.tenantId,
    isOwner: user.isOwner,
    permissions: user.isOwner
      ? [...ALL_KEYS]
      : [...expandPermissions(user.role?.permissions ?? [])],
  };
}
