import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { paginate, requireTenant, respondError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import type { ListResult } from "@csq/core/types/dashboard";

// List of the tenant's users. The team management page is OWNER-only
// (FR-AU-005, gated server-side via SEC-3), but STAFF also reads this list:
// the inbox assignment picker (FEA-6, PRD 16) needs the member names. All
// mutations on team routes stay OWNER-only. Tenant scoping comes from the
// session (requireTenant), never the query. Select is explicit so we never
// leak passwordHash to the dashboard.

export type UserItem = {
  id: string;
  email: string;
  name: string | null;
  role: "OWNER" | "STAFF";
  canRunCampaigns: boolean;
  createdAt: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ListResult<UserItem>>>
) {
  if (req.method !== "GET") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER", "STAFF")) {
    return respondError(res, "PERMISSION_DENIED", "Akses ditolak.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const { skip, take, page, pageSize } = paginate(req.query);

    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where: { tenantId },
        skip,
        take,
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          canRunCampaigns: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where: { tenantId } }),
    ]);

    const items: UserItem[] = rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      // Narrow the Prisma UserRole enum to the literal union without `as`.
      // The ternary branches return string literals, so the result type is
      // "OWNER" | "STAFF" (string-enum ↔ string-literal comparison is allowed).
      role: u.role === "OWNER" ? "OWNER" : "STAFF",
      canRunCampaigns: u.role === "OWNER" ? true : u.canRunCampaigns,
      createdAt: u.createdAt.toISOString(),
    }));

    return res.status(200).json(apiOk({ items, total, page, pageSize }));
  });
}
