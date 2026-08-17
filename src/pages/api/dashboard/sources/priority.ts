import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import prisma from "@/lib/db";
import { getAuthSession } from "@/lib/auth";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

// Source priority config (PRD §13). Stored in Tenant.settings.sourcePriority
// as an ordered array of DataSourceType. Tenant.settings is a Json column;
// read/written through Zod (never `as`).

const priorityValueSchema = z.enum(["MANUAL", "EXCEL", "GOOGLE_SHEETS"]);
const tenantSettingsSchema = z
  .object({ sourcePriority: z.array(priorityValueSchema).optional() })
  .passthrough();

const priorityUpdateSchema = z.object({
  sourcePriority: z.array(priorityValueSchema).min(1),
});

type PriorityResponse = { sourcePriority: string[] };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<PriorityResponse>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  if (req.method === "GET") {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return respondError(res, "NOT_FOUND", "Tenant tidak ditemukan.");
    const settings = tenantSettingsSchema.parse(tenant.settings ?? {});
    return res.status(200).json(
      apiOk({ sourcePriority: settings.sourcePriority ?? ["MANUAL", "EXCEL", "GOOGLE_SHEETS"] })
    );
  }

  if (req.method === "PUT") {
    // Owner-only — priority is a tenant-wide policy (PRD §13).
    if (session.user.role !== "OWNER") {
      return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengubah prioritas sumber.");
    }
    const parsed = priorityUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return respondError(res, "NOT_FOUND", "Tenant tidak ditemukan.");
    const settings = tenantSettingsSchema.parse(tenant.settings ?? {});
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        settings: { ...settings, sourcePriority: parsed.data.sourcePriority },
      },
    });
    return res.status(200).json(apiOk({ sourcePriority: parsed.data.sourcePriority }));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
