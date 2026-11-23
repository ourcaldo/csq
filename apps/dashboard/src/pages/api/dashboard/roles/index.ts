import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { ALL_KEYS, OWNER_ONLY_KEYS } from "@csq/core/lib/permissions-catalog";

// PRD 29 - tenant custom roles CRUD. peran.kelola is an owner-only key, so
// only the owner reaches any method. Owner-only keys can never be written
// into a role (filtered here AND rejected by requirePermission at
// enforcement time - the backstop).

export type RoleItem = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
  createdAt: string;
};

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).optional(),
  permissions: z.array(z.string()).max(ALL_KEYS.length + OWNER_ONLY_KEYS.length),
});

const PERMISSION_KEYS = z.string().refine((k) => ALL_KEYS.includes(k), {
  message: "Kunci izin tidak dikenal.",
});

function validPermissions(keys: string[]): string[] | null {
  const parsed = z.array(PERMISSION_KEYS).safeParse(keys);
  if (!parsed.success) return null;
  return [...new Set(parsed.data.filter((k) => !OWNER_ONLY_KEYS.includes(k)))];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ items: RoleItem[] } | RoleItem>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requirePermission(session, "peran.kelola")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya pemilik yang dapat mengelola peran.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method === "GET") {
      const roles = await prisma.role.findMany({
        where: { tenantId },
        orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }],
        include: { _count: { select: { users: true } } },
      });
      const items: RoleItem[] = roles.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        permissions: r.permissions,
        userCount: r._count.users,
        createdAt: r.createdAt.toISOString(),
      }));
      return res.status(200).json(apiOk({ items }));
    }

    if (req.method === "POST") {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(res, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Input tidak valid.");
      }
      const permissions = validPermissions(parsed.data.permissions);
      if (!permissions) {
        return respondError(res, "VALIDATION_ERROR", "Kunci izin tidak dikenal.");
      }
      const exists = await prisma.role.findFirst({
        where: { tenantId, name: parsed.data.name },
        select: { id: true },
      });
      if (exists) {
        return respondError(res, "VALIDATION_ERROR", "Nama peran sudah dipakai.");
      }
      const role = await prisma.role.create({
        data: {
          tenantId,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          permissions,
        },
      });
      await logHuman({
        actorEmail: session.user.email ?? undefined,
        tenantId,
        action: "role.created",
        entityType: "Role",
        entityId: role.id,
        afterValue: { name: role.name, permissions },
      });
      return res.status(201).json(
        apiOk({
          id: role.id,
          name: role.name,
          description: role.description,
          isSystem: role.isSystem,
          permissions: role.permissions,
          userCount: 0,
          createdAt: role.createdAt.toISOString(),
        })
      );
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
