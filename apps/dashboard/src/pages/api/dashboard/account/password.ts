import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { verifyPassword, hashPassword } from "@csq/core/lib/password";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

// Audit run-3 (admin.tenant-owner-takeover): the single endpoint a
// mustChangePassword-flagged user may call. Verifies the current password,
// sets the new one, bumps the revocation stamp (killing every other
// outstanding session, including the bootstrap credential an admin reset
// emailed) and clears the rotation flag. getAuthSession's path exemption
// names this route explicitly.

const changeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8)
    .max(100)
    .refine((v) => v !== "demo1234", "Pilih kata sandi yang baru."),
});

type Result = { changed: true };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Result>>
) {
  if (req.method !== "PUT") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    const parsed = changeSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Input tidak valid.");
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, passwordHash: true },
    });
    if (!user) return respondError(res, "NOT_FOUND", "Pengguna tidak ditemukan.");

    const ok = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
    if (!ok) {
      return respondError(res, "VALIDATION_ERROR", "Kata sandi saat ini salah.");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(parsed.data.newPassword),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    });

    // The caller's own JWT still carries the OLD stamp; every further
    // request re-authenticates. The client redirects to /login right after
    // this response, so the flow is a deliberate re-login.
    return res.status(200).json(apiOk({ changed: true }));
  });
}
