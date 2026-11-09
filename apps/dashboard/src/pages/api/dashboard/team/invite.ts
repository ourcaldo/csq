import { createHash, randomBytes } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import { getTenantEntitlements } from "@csq/core/lib/entitlements";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { getEmailProvider } from "@csq/core/lib/email-config";
import { sendEmailWithProvider } from "@csq/core/services/email";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

// FEA-5 (PRD 16): the owner invites a staff member by email. No account and
// no password exist after this call - only a one-time TeamInvite whose raw
// token (random 32 bytes) is never stored, just its sha256 hash, with a
// 7-day expiry. The invitee sets their own password on /accept-invite. When
// the tenant has no email provider configured, or the send fails, the invite
// link is returned ONCE so the owner can relay it out-of-band.

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const inviteSchema = z.object({
  email: z.string().email().min(1),
  name: z.string().min(1).max(120),
});

const inviteResultSchema = z.object({
  inviteId: z.string(),
  email: z.string(),
  role: z.literal("STAFF"),
  emailed: z.boolean(),
  inviteLink: z.string().optional(),
  note: z.string().optional(),
});
export type InviteResult = z.infer<typeof inviteResultSchema>;

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
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

  return withTenantContext(tenantId, async () => {
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(
        res,
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Input tidak valid."
      );
    }

    const email = parsed.data.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return respondError(res, "VALIDATION_ERROR", "Email sudah terdaftar.");
    }

    // Plan staff seats (PRD 13). Owner is not a seat; only STAFF users count.
    const entitlements = await getTenantEntitlements(tenantId);
    if (entitlements.staffLimit !== null) {
      const staff = await prisma.user.count({ where: { tenantId, role: "STAFF" } });
      if (staff >= entitlements.staffLimit) {
        return respondError(
          res,
          "PERMISSION_DENIED",
          `Paket ${entitlements.planName ?? "tenant"} hanya mendukung ${entitlements.staffLimit} staf.`
        );
      }
    }

    const token = randomBytes(32).toString("hex");
    const invite = await prisma.teamInvite.create({
      data: {
        tenantId,
        email,
        role: "STAFF",
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        invitedById: session.user.id,
      },
    });

    const inviteLink = `${process.env.NEXTAUTH_URL ?? ""}/accept-invite?token=${token}`;

    const provider = await getEmailProvider(tenantId);
    let emailed = false;
    if (provider) {
      try {
        await sendEmailWithProvider(provider, {
          to: email,
          subject: "Undangan tim CSQ",
          text:
            `Halo ${parsed.data.name},\n\n` +
            "Anda diundang bergabung ke tim CSQ. Buka tautan berikut untuk membuat password dan mengaktifkan akun Anda:\n\n" +
            `${inviteLink}\n\n` +
            "Tautan berlaku 7 hari dan hanya dapat dipakai sekali. Jika Anda tidak merasa diundang, abaikan email ini.",
        });
        emailed = true;
      } catch {
        // A failed send degrades to the manual relay path below (FEA-5).
        emailed = false;
      }
    }

    await logHuman({
      tenantId,
      action: "user.invited",
      entityType: "TeamInvite",
      entityId: invite.id,
      afterValue: { email, role: "STAFF", emailed, expiresAt: invite.expiresAt.toISOString() },
    });

    const result = inviteResultSchema.parse(
      emailed
        ? { inviteId: invite.id, email, role: "STAFF", emailed }
        : {
            inviteId: invite.id,
            email,
            role: "STAFF",
            emailed,
            inviteLink,
            note: "Email belum dikonfigurasi - bagikan tautan ini secara manual.",
          }
    );

    return res.status(201).json(apiOk(result));
  });
}
