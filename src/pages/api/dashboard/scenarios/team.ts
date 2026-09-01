import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import type { ListResult } from "@/types/dashboard";

// Member picker for the scenario builder's "Tugaskan" (assign) node. Unlike
// /api/dashboard/team (OWNER-only team MANAGEMENT, PRD FR-AU-005), this is a
// read-only id/name/role list for a dropdown: assigning a conversation is
// already a STAFF capability in the inbox, and STAFF can edit scenarios, so
// any authenticated member of the tenant may read it. Tenant scoping comes
// from the session (requireTenant), never the query. Explicit select — the
// passwordHash never leaves the DB. Bounded at 500: a tenant member list is
// small, and the dropdown degrades to a manual ID input past that.

export type ScenarioTeamMember = {
  id: string;
  name: string;
  role: "OWNER" | "STAFF";
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ListResult<ScenarioTeamMember>>>
) {
  if (req.method !== "GET") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");

  const tenantId = requireTenant(session);

  const rows = await prisma.user.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    take: 500,
    select: { id: true, name: true, email: true, role: true },
  });

  const items: ScenarioTeamMember[] = rows.map((u) => ({
    id: u.id,
    // Display label for the dropdown/node card; email keeps it identifiable
    // when a member has no name set.
    name: u.name ?? u.email,
    // Narrow the Prisma UserRole enum to the literal union without `as`.
    role: u.role === "OWNER" ? "OWNER" : "STAFF",
  }));

  return res
    .status(200)
    .json(apiOk({ items, total: items.length, page: 1, pageSize: items.length }));
}
