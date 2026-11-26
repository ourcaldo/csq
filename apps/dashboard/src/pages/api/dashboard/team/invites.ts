import type { NextApiRequest, NextApiResponse } from "next";
import { createHash, randomBytes } from "crypto";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { withTenantContext, withSystemTransaction } from "@csq/core/lib/tenant-context";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { logHuman } from "@csq/core/lib/audit";
import { resolveEmailProvider } from "@csq/core/lib/email-config";
import { sendEmailWithProvider } from "@csq/core/services/email";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

// Pending-invitation management (PRD 28 Part F.2, owner request 2026-11-21).
// OWNER-only. GET lists the tenant's invites with computed status;
// DELETE ?id= cancels (token dead immediately, seat freed);
// POST ?id=resend issues a fresh token for the same email (new TTL) and
// re-emails when a provider is configured.

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

type InviteView = {
  id: string;
  email: string;
  roleId: string | null;
  roleName: string | null;
  status: "PENDING" | "EXPIRED" | "ACCEPTED";
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ items: InviteView[] } | { inviteId: string; emailed: boolean; inviteLink?: string }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  // Owner decision 2026-11-26: invite status is readable by every member;
  // cancel/resend stay owner-gated.
  if (req.method !== "GET" && !requirePermission(session, "pengaturan.tim")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengelola undangan.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method === "GET") {
      const rows = await prisma.teamInvite.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { role: { select: { name: true } } },
      });
      const now = new Date();
      const items: InviteView[] = rows.map((i) => ({
        id: i.id,
        email: i.email,
        roleId: i.roleId,
        roleName: i.role?.name ?? null,
        status: i.acceptedAt ? "ACCEPTED" : i.expiresAt <= now ? "EXPIRED" : "PENDING",
        createdAt: i.createdAt.toISOString(),
        expiresAt: i.expiresAt.toISOString(),
        acceptedAt: i.acceptedAt?.toISOString() ?? null,
      }));
      return res.status(200).json(apiOk({ items }));
    }

    const id = typeof req.query.id === "string" ? req.query.id : "";
    if (!id) return respondError(res, "VALIDATION_ERROR", "ID undangan tidak valid.");
    const invite = await prisma.teamInvite.findFirst({ where: { id, tenantId } });
    if (!invite) return respondError(res, "NOT_FOUND", "Undangan tidak ditemukan.");

    if (req.method === "DELETE") {
      // Cancel: hard-delete the row. The token dies immediately (hash gone)
      // and the seat frees from the staffLimit pending count.
      await prisma.teamInvite.delete({ where: { id: invite.id } });
      await logHuman({
        actorEmail: session.user.email ?? undefined,
        tenantId,
        action: "team.invite_cancelled",
        entityType: "TeamInvite",
        entityId: invite.id,
        beforeValue: { email: invite.email, expiresAt: invite.expiresAt.toISOString() },
      });
      return res.status(200).json(apiOk({ inviteId: invite.id, emailed: false, cancelled: true }));
    }

    if (req.method === "POST") {
      // Resend: fresh token + fresh TTL on the same email. The old invite row
      // is replaced so only the newest link works.
      if (invite.acceptedAt) {
        return respondError(res, "VALIDATION_ERROR", "Undangan ini sudah diterima.");
      }
      // Frequency guard: a resend rewrites the token, which kills the link
      // from the previous email. Rapid double-clicks must not invalidate the
      // mail that is already in flight - 60 seconds between resends.
      const RESEND_COOLDOWN_MS = 60_000;
      if (Date.now() - invite.createdAt.getTime() < RESEND_COOLDOWN_MS) {
        return respondError(
          res,
          "VALIDATION_ERROR",
          "Tunggu 1 menit sebelum mengirim ulang undangan yang sama."
        );
      }
      const token = randomBytes(32).toString("hex");
      const updated = await prisma.teamInvite.update({
        where: { id: invite.id },
        data: {
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          // createdAt doubles as "last sent": the Team page shows it as
          // Dikirim and the 60s cooldown keys on it.
          createdAt: new Date(),
        },
      });
      const inviteLink = `${process.env.NEXTAUTH_URL ?? ""}/accept-invite?token=${token}`;
      const provider = await resolveEmailProvider(tenantId);
      let emailed = false;
      if (provider) {
        try {
          await sendEmailWithProvider(provider, {
            to: invite.email,
            subject: "Undangan tim CSQ",
            text:
              "Anda diundang bergabung ke tim CSQ. Buka tautan berikut untuk membuat password dan mengaktifkan akun Anda:\n\n" +
              `${inviteLink}\n\n` +
              "Tautan berlaku 7 hari dan hanya dapat dipakai sekali. Jika Anda tidak merasa diundang, abaikan email ini.",
          });
          emailed = true;
        } catch (err) {
          // Log it: silent failures are exactly why the owner thought invites
          // "failed" while the rows existed (PRD 28 Part F).
          console.error("[team/invites] resend email failed:", err);
          emailed = false;
        }
      }
      await logHuman({
        actorEmail: session.user.email ?? undefined,
        tenantId,
        action: "team.invite_resent",
        entityType: "TeamInvite",
        entityId: invite.id,
        afterValue: { email: invite.email, emailed, expiresAt: updated.expiresAt.toISOString() },
      });
      return res.status(200).json(
        apiOk(
          emailed
            ? { inviteId: invite.id, emailed }
            : {
                inviteId: invite.id,
                emailed,
                inviteLink,
                note: "Email belum terkirim - bagikan tautan ini secara manual.",
              }
        )
      );
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
