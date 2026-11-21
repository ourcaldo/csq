import { createHash } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import prisma from "@csq/core/lib/db";
import { hashPassword } from "@csq/core/lib/password";
import { logHuman } from "@csq/core/lib/audit";
import { withSystemContext, withSystemTransaction } from "@csq/core/lib/tenant-context";
import { respondError, strQuery } from "@csq/core/lib/queries";
import { getTenantEntitlements } from "@csq/core/lib/entitlements";
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
        return respondError(res, "VALIDATION_ERROR", "Tautan undangan tidak valid - token tidak ditemukan di URL.");
      }
      const invite = await prisma.teamInvite.findUnique({
        where: { tokenHash: hashToken(token) },
      });
      if (!invite) {
        return respondError(res, "NOT_FOUND", "Undangan tidak ditemukan - mungkin sudah dibatalkan atau tautannya tidak lengkap. Minta owner mengirim ulang undangan.");
      }
      if (invite.acceptedAt) {
        return respondError(res, "VALIDATION_ERROR", "Undangan ini sudah pernah dipakai. Masuk dengan email dan password Anda, atau minta owner undangan baru.");
      }
      if (invite.expiresAt <= new Date()) {
        return respondError(res, "VALIDATION_ERROR", "Undangan sudah kedaluwarsa (berlaku 7 hari). Minta owner mengirim ulang dari halaman Tim.");
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
    if (!invite) {
      return respondError(res, "NOT_FOUND", "Undangan tidak ditemukan - mungkin sudah dibatalkan atau tautannya tidak lengkap. Minta owner mengirim ulang undangan.");
    }
    if (invite.acceptedAt) {
      return respondError(res, "VALIDATION_ERROR", "Undangan ini sudah pernah dipakai. Masuk dengan email dan password Anda, atau minta owner undangan baru.");
    }
    if (invite.expiresAt <= new Date()) {
      return respondError(res, "VALIDATION_ERROR", "Undangan sudah kedaluwarsa (berlaku 7 hari). Minta owner mengirim ulang dari halaman Tim.");
    }

    const existing = await prisma.user.findUnique({ where: { email: invite.email } });
    if (existing) {
      return respondError(res, "VALIDATION_ERROR", "Email sudah terdaftar - masuk saja.");
    }

    // Seat-limit re-check at the moment the seat is consumed (audit run-1,
    // invite-accept-staff-limit-bypass): the invite-time count excluded
    // pending invites, and this public route ran with no entitlements check
    // at all. The invite stays burnable if rejected, so a stale over-limit
    // invite does not lock the owner out of anything but seat creation.
    // Audit run-2 (invite-accept-stafflimit-toctou): the count-then-create
    // was non-atomic - concurrent accepts all read the same stale count.
    // Now one transaction with a tenant advisory lock serializes the seat
    // check + create, so the limit holds under concurrency.
    const entitlements = await getTenantEntitlements(invite.tenantId);
    if (entitlements.staffLimit !== null && invite.role === "STAFF") {
      const staffLimit = entitlements.staffLimit;
      const tenantLockKey = (BigInt(
        // Stable 63-bit key from the tenant UUID (fnv-ish fold of both halves).
        BigInt(`0x${invite.tenantId.replace(/-/g, "").slice(0, 16)}`)
      ) &
        BigInt("0x7fffffffffffffff")) as bigint;
      const user = await withSystemTransaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${tenantLockKey})`;
        const staff = await tx.user.count({
          where: { tenantId: invite.tenantId, role: "STAFF" },
        });
        if (staff >= staffLimit) {
          return null;
        }
        return tx.user.create({
          data: {
            email: invite.email,
            name: parsed.data.name ?? null,
            passwordHash: await hashPassword(parsed.data.password),
            role: invite.role,
            tenantId: invite.tenantId,
          },
        });
      });
      if (!user) {
        return respondError(
          res,
          "PERMISSION_DENIED",
          `Kuota staf paket sudah penuh (${entitlements.staffLimit}). Hubungi owner.`
        );
      }
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
