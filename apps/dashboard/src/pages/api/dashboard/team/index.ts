import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { paginate, requireTenant, respondError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import type { ListResult } from "@csq/core/types/dashboard";

// List of the tenant's users. Readable by every member (owner decision
// 2026-11-26: settings info is open, changes gated) - the team page renders
// view-only without pengaturan.tim, and the inbox assignment picker
// (FEA-6, PRD 16) reads it too. All mutations on team routes stay
// pengaturan.tim. Tenant scoping comes from the session (requireTenant),
// never the query. Select is explicit so we never leak passwordHash.

export type UserItem = {
  id: string;
  email: string;
  name: string | null;
  isOwner: boolean;
  roleId: string | null;
  roleName: string | null;
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
          isOwner: true,
          roleId: true,
          role: { select: { name: true } },
          createdAt: true,
        },
      }),
      prisma.user.count({ where: { tenantId } }),
    ]);

    const items: UserItem[] = rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      isOwner: u.isOwner,
      roleId: u.roleId,
      roleName: u.role?.name ?? null,
      createdAt: u.createdAt.toISOString(),
    }));

    return res.status(200).json(apiOk({ items, total, page, pageSize }));
  });
}
