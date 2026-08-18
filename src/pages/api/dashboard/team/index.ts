import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { paginate, requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import type { ListResult } from "@/types/dashboard";

// OWNER-only list of the tenant's users (PRD FR-AU-005). Tenant scoping comes
// from the session (requireTenant), never the query. Select is explicit so we
// never leak passwordHash to the dashboard.

export type UserItem = {
  id: string;
  email: string;
  name: string | null;
  role: "OWNER" | "STAFF";
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
  if (!requireRole(session, "OWNER")) {
    return respondError(
      res,
      "PERMISSION_DENIED",
      "Hanya owner yang dapat melihat daftar tim."
    );
  }
  const tenantId = requireTenant(session);

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
    createdAt: u.createdAt.toISOString(),
  }));

  return res.status(200).json(apiOk({ items, total, page, pageSize }));
}
