import { createHash } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import prisma from "@csq/core/lib/db";
import { hashPassword } from "@csq/core/lib/password";
import { logHuman } from "@csq/core/lib/audit";
import { withSystemContext } from "@csq/core/lib/tenant-context";
import { respondError, strQuery } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

// FEA-5 (PRD 16): public consumer of the one-time invite token. There is no
// session yet - the invite is looked up by token hash across tenants, so the
// whole handler runs in the system (bypass) context, exactly like register.
// GET resolves the token for the set-password page; POST creates the User
// (password is the invitee's own choice, so mustChangePassword stays false)
// and burns the token by setting acceptedAt.

const acceptSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password minimal 8 karakter"),
  name: z.string().min(1).max(120).optional(),
});

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ email: string } | { userId: string }>>
) {
  return withSystemContext(async () => {
    if (req.method === "GET") {
      const token = strQuery(req.query, "token");
      if (!token) {
        return respondError(res, "VALIDATION_ERROR", "Tautan undangan tidak valid.");
      }
      const invite = await prisma.teamInvite.findUnique({
        where: { tokenHash: hashToken(token) },
      });
      if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) {
        return respondError(
          res,
          "VALIDATION_ERROR",
          "Undangan tidak valid atau sudah kedaluwarsa."
        );
      }
      return res.status(200).json(apiOk({ email: invite.email }));
    }

    if (req.method !== "POST") {
      return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
    }

    const parsed = acceptSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(
        res,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Input tidak valid."
      );
    }

    const invite = await prisma.teamInvite.findUnique({
      where: { tokenHash: hashToken(parsed.data.token) },
    });
    if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) {
      return respondError(
        res,
        "VALIDATION_ERROR",
        "Undangan tidak valid atau sudah kedaluwarsa."
      );
    }

    const existing = await prisma.user.findUnique({ where: { email: invite.email } });
    if (existing) {
      return respondError(res, "VALIDATION_ERROR", "Email sudah terdaftar - masuk saja.");
    }

    const user = await prisma.user.create({
      data: {
        email: invite.email,
        name: parsed.data.name ?? null,
        passwordHash: await hashPassword(parsed.data.password),
        role: invite.role,
        tenantId: invite.tenantId,
      },
    });
    await prisma.teamInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });
    await logHuman({
      tenantId: invite.tenantId,
      action: "user.invite_accepted",
      entityType: "User",
      entityId: user.id,
      beforeValue: { inviteId: invite.id, email: invite.email, acceptedAt: null },
      afterValue: { inviteId: invite.id, userId: user.id, role: user.role },
    });

    return res.status(201).json(apiOk({ userId: user.id }));
  });
}
