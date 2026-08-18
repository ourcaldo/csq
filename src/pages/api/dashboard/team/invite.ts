import { randomBytes } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

// Owner invites a staff member into their tenant (PRD FR-AU-006 / plan 2.10).
// MVP has no email transport, so we create the STAFF user with a generated
// temporary password and return it ONCE for the owner to relay out-of-band.
// The user is scoped to the owner's tenantId (from the session, never the body).

const inviteSchema = z.object({
  email: z.string().email().min(1),
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(128).optional(),
});

export type InviteResult = {
  userId: string;
  email: string;
  name: string;
  role: "STAFF";
  tempPassword: string;
};

function generateTempPassword(): string {
  // 12 bytes → 16 base64url chars; safe, opaque, single-use.
  return randomBytes(12).toString("base64url");
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<InviteResult>>
) {
  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(
      res,
      "PERMISSION_DENIED",
      "Hanya owner yang dapat mengundang staff."
    );
  }
  const tenantId = requireTenant(session);

  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    return respondError(res, "VALIDATION_ERROR", parsed.error.message);
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return respondError(res, "VALIDATION_ERROR", "Email sudah terdaftar.");
  }

  const tempPassword = parsed.data.password ?? generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const user = await prisma.user.create({
    data: {
      email,
      name: parsed.data.name,
      passwordHash,
      role: "STAFF",
      tenantId,
    },
  });

  return res.status(201).json(
    apiOk({
      userId: user.id,
      email: user.email,
      name: user.name ?? parsed.data.name,
      role: "STAFF",
      tempPassword,
    })
  );
}
