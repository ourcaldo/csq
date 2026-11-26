import type { NextApiRequest, NextApiResponse } from "next";
import type { CourseLevel } from "@prisma/client";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { courseLevelCreateSchema } from "@csq/core/types/product";

// PRD 32: tenant-defined course level list (searchable pick-or-add in the
// course composer). GET lists, POST creates.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<CourseLevel[] | CourseLevel>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method === "GET") {
      if (!requirePermission(session, "produk.lihat")) {
        return respondError(res, "PERMISSION_DENIED", "Tidak punya akses produk.");
      }
      const items = await prisma.courseLevel.findMany({
        where: { tenantId },
        orderBy: { name: "asc" },
      });
      return res.status(200).json(apiOk(items));
    }

    if (req.method === "POST") {
      if (!requirePermission(session, "produk.kelola")) {
        return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat membuat level.");
      }
      const parsed = courseLevelCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return respondError(res, "VALIDATION_ERROR", parsed.error.message);
      }
      const existing = await prisma.courseLevel.findFirst({
        where: { tenantId, name: parsed.data.name },
      });
      if (existing) return res.status(200).json(apiOk(existing));
      const created = await prisma.courseLevel.create({
        data: { tenantId, name: parsed.data.name },
      });
      await logHuman({
        tenantId,
        action: "courseLevel.create",
        entityType: "CourseLevel",
        entityId: created.id,
        afterValue: created,
      });
      return res.status(201).json(apiOk(created));
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
