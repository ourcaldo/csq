import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import prisma from "@csq/core/lib/db";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin, auditAdminAction } from "@/lib/admin-auth";
import { withSystemContext } from "@csq/core/lib/tenant-context";
import {
  emailProviderSchema,
  getPlatformEmailProvider,
  savePlatformEmailProvider,
  clearPlatformEmailProvider,
  maskEmailProvider,
} from "@csq/core/lib/email-config";

// Platform email provider (owner request 2026-11-10): the admin console's
// SMTP, used as the DEFAULT sender for every email (staff invites, scenario
// Email nodes, test sends). A tenant's own provider takes precedence; tenants
// without one fall back to this. Stored on the BillingSetting singleton -
// same shape and secret handling as the per-tenant provider.
//
// SMTP-only form for now; the stored schema already accepts Resend if that
// is ever wanted at platform level. GET/audit are masked - the credential
// never leaves the server.

const putSchema = z.object({
  type: z.literal("SMTP"),
  host: z.string().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().max(255),
  // May be omitted to keep the stored password (editing host/from only).
  password: z.string().max(255).optional(),
  from: z.string().min(3).max(320),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  return withSystemContext(async () => {
    if (req.method === "GET") {
      const provider = await getPlatformEmailProvider();
      return res
        .status(200)
        .json(apiOk(provider ? maskEmailProvider(provider) : { configured: false }));
    }

    if (req.method === "PUT") {
      const parsed = putSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json(apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload tidak valid."));
      }
      const existing = await getPlatformEmailProvider();
      const password =
        parsed.data.password || (existing?.type === "SMTP" ? existing.password : "");
      if (!password) {
        return res.status(400).json(apiError("VALIDATION_ERROR", "Password SMTP wajib diisi."));
      }
      // Re-validate the merged value against the shared stored schema so
      // exactly one shape is persisted, like the tenant path.
      const stored = emailProviderSchema.safeParse({ ...parsed.data, password });
      if (!stored.success) {
        return res.status(400).json(apiError("VALIDATION_ERROR", stored.error.message));
      }
      await savePlatformEmailProvider(stored.data);
      await auditAdminAction({
        adminId: admin.adminId,
        action: "platform_email.update",
        targetType: "BillingSetting",
        targetId: "singleton",
        beforeValue: existing ? maskEmailProvider(existing) : { configured: false },
        afterValue: maskEmailProvider(stored.data),
      });
      return res.status(200).json(apiOk(maskEmailProvider(stored.data)));
    }

    if (req.method === "DELETE") {
      const before = await getPlatformEmailProvider();
      if (before) {
        await clearPlatformEmailProvider();
        await auditAdminAction({
          adminId: admin.adminId,
          action: "platform_email.disconnect",
          targetType: "BillingSetting",
          targetId: "singleton",
          beforeValue: maskEmailProvider(before),
          afterValue: { configured: false },
        });
      }
      return res.status(200).json(apiOk({ configured: false }));
    }

    return res.status(405).json(apiError("VALIDATION_ERROR", "Metode tidak didukung."));
  });
}
