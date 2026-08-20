import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import prisma from "@/lib/db";
import { getAuthSession, requireRole } from "@/lib/auth";
import { logHuman } from "@/lib/audit";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { readSourcePriority } from "@/lib/source-priority";

// Source priority config (PRD §13). Stored in Tenant.settings.sourcePriority
// as an ordered array of DataSourceType. Tenant.settings is a Json column;
// read/written through Zod (never `as`). The GET is resilient to legacy
// stored values that may include entries outside the valid set (e.g. an old
// "MEMORY" entry) — invalid entries are dropped instead of throwing a 500.
//
// readSourcePriority is the single source of truth — shared with the tools/
// import layer that actually resolves inventory by priority (src/lib/source-priority.ts).

// Permissive read shape for stored settings (any strings allowed, then filtered).
const storedSettingsSchema = z
  .object({ sourcePriority: z.array(z.string()).optional() })
  .passthrough();

// Strict input for the PUT (client must send valid values).
const priorityUpdateSchema = z.object({
  sourcePriority: z.array(z.enum(["MANUAL", "EXCEL", "GOOGLE_SHEETS"])).min(1),
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
    return res
      .status(200)
      .json(apiOk({ sourcePriority: readSourcePriority(tenant.settings) }));
  }

  if (req.method === "PUT") {
    // Owner-only — priority is a tenant-wide policy (PRD §13).
    if (!requireRole(session, "OWNER")) {
      return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengubah prioritas sumber.");
    }
    const parsed = priorityUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return respondError(res, "NOT_FOUND", "Tenant tidak ditemukan.");
    // Merge onto the existing settings (preserve unrelated keys), replacing
    // sourcePriority with the validated order.
    const existing = storedSettingsSchema.safeParse(tenant.settings ?? {});
    const base = existing.success ? existing.data : {};
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        settings: { ...base, sourcePriority: parsed.data.sourcePriority },
      },
    });
    await logHuman({
      tenantId,
      action: "source.priority_update",
      entityType: "Tenant",
      entityId: tenantId,
      afterValue: { sourcePriority: parsed.data.sourcePriority },
    });
    return res.status(200).json(apiOk({ sourcePriority: parsed.data.sourcePriority }));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
