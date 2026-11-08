import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@csq/core/lib/db";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin, auditAdminAction } from "@/lib/admin-auth";

// API keys (PRD 13 Phase 4): cross-tenant list + revoke.

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === "GET") {
    const keys = await prisma.apiKey.findMany({
      orderBy: { createdAt: "desc" },
      include: { tenant: { select: { name: true, slug: true } } },
    });
    return res.status(200).json(apiOk({
      items: keys.map((k) => ({
        id: k.id, name: k.name, prefix: k.prefix,
        tenantName: k.tenant.name, tenantSlug: k.tenant.slug,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        revokedAt: k.revokedAt?.toISOString() ?? null,
        createdAt: k.createdAt.toISOString(),
      })),
    }));
  }

  if (req.method === "DELETE") {
    const { id } = req.query;
    if (typeof id !== "string") {
      return res.status(400).json(apiError("VALIDATION_ERROR", "ID kunci tidak valid."));
    }
    const key = await prisma.apiKey.findUnique({ where: { id } });
    if (!key) {
      return res.status(404).json(apiError("NOT_FOUND", "Kunci API tidak ditemukan."));
    }
    if (key.revokedAt) {
      return res.status(200).json(apiOk({ id: key.id, revokedAt: key.revokedAt.toISOString() }));
    }
    const updated = await prisma.apiKey.update({
      where: { id }, data: { revokedAt: new Date() },
    });
    await auditAdminAction({
      adminId: admin.adminId, action: "apikey.revoke",
      targetType: "ApiKey", targetId: id,
      afterValue: { name: updated.name, prefix: updated.prefix },
    });
    return res.status(200).json(apiOk({ id: updated.id, revokedAt: updated.revokedAt?.toISOString() ?? null }));
  }

  return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));
}
