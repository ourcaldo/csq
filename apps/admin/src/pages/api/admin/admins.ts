import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin, auditAdminAction } from "@/lib/admin-auth";
import { hashPassword } from "@csq/core/lib/password";
import { z } from "zod";
import { withSystemContext } from "@csq/core/lib/tenant-context";

// Operator management (PRD 13 Phase 4).

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100),
  password: z.string().min(8).max(200),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  return withSystemContext(async () => {

    if (req.method === "GET") {
      const items = await prisma.adminUser.findMany({
        orderBy: { createdAt: "asc" },
        select: { id: true, email: true, name: true, createdAt: true },
      });
      return res.status(200).json(apiOk({
        items: items.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
      }));
    }

    if (req.method === "POST") {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json(apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload tidak valid."));
      }
      const existing = await prisma.adminUser.findUnique({ where: { email: parsed.data.email } });
      if (existing) {
        return res.status(409).json(apiError("VALIDATION_ERROR", `Email "${parsed.data.email}" sudah ada.`));
      }
      const created = await prisma.adminUser.create({
        data: {
          email: parsed.data.email,
          name: parsed.data.name,
          passwordHash: await hashPassword(parsed.data.password),
        },
        select: { id: true, email: true, name: true, createdAt: true },
      });
      await auditAdminAction({
        adminId: admin.adminId, action: "admin.create",
        targetType: "AdminUser", targetId: created.id,
        afterValue: { email: created.email, name: created.name },
      });
      return res.status(201).json(apiOk({ ...created, createdAt: created.createdAt.toISOString() }));
    }

    if (req.method === "DELETE") {
      const { id } = req.query;
      if (typeof id !== "string") {
        return res.status(400).json(apiError("VALIDATION_ERROR", "ID admin tidak valid."));
      }
      if (id === admin.adminId) {
        return res.status(400).json(apiError("VALIDATION_ERROR", "Tidak bisa menghapus akun sendiri."));
      }
      const target = await prisma.adminUser.findUnique({ where: { id } });
      if (!target) {
        return res.status(404).json(apiError("NOT_FOUND", "Admin tidak ditemukan."));
      }
      const count = await prisma.adminUser.count();
      if (count <= 1) {
        return res.status(400).json(apiError("VALIDATION_ERROR", "Minimal satu admin harus tersisa."));
      }
      await prisma.adminUser.delete({ where: { id } });
      await auditAdminAction({
        adminId: admin.adminId, action: "admin.delete",
        targetType: "AdminUser", targetId: id,
        beforeValue: { email: target.email, name: target.name },
      });
      return res.status(200).json(apiOk({ id, deleted: true }));
    }

    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));

  });
}
