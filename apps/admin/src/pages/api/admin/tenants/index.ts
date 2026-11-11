import type { NextApiRequest, NextApiResponse } from "next";
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "@csq/core/lib/db";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin, auditAdminAction } from "@/lib/admin-auth";
import { createTenantWithOwner } from "@csq/core/lib/provision-tenant";
import { resolveEmailProvider } from "@csq/core/lib/email-config";
import { sendEmailWithProvider } from "@csq/core/services/email";
import { z } from "zod";
import { withSystemContext } from "@csq/core/lib/tenant-context";

// Tenant list + create (PRD 13 Phase 2). Operator-only.

export type TenantSummary = {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  userCount: number;
  channelCount: number;
  conversationCount: number;
  messageCount30d: number;
  mediaBytes: number;
};

const createSchema = z.object({
  name: z.string().min(2).max(100),
  // Optional since 2026-11-11 (owner request): the console no longer asks
  // for a slug - the API generates a unique alphanumeric one (Midtrans
  // merchant-ID style). Still accepted for scripts/tests that pass one.
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Slug: lowercase alphanumeric + dashes")
    .optional(),
  ownerEmail: z.string().email(),
  ownerName: z.string().min(2).max(100),
  ownerPassword: z.string().min(8).max(200),
});

// Random alphanumeric tenant ID, no visually confusable characters
// (0/o, 1/l/i). Server-generated so uniqueness is checkable at insert time.
const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function candidateSlug(): string {
  const bytes = randomBytes(8);
  return "csq" + Array.from(bytes, (b) => SLUG_ALPHABET[b % SLUG_ALPHABET.length]).join("");
}

async function generateUniqueSlug(): Promise<string> {
  // Pre-check the first few candidates (cheap); on the last attempt return
  // the candidate and let the @unique constraint be the final arbiter.
  for (let attempt = 0; ; attempt++) {
    const slug = candidateSlug();
    if (attempt >= 4) return slug;
    const taken = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (!taken) return slug;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<unknown>>
) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  return withSystemContext(async () => {

    if (req.method === "GET") {
      // ADM-2 (PRD 16): q matches name or slug, status filters ACTIVE/SUSPENDED.
      const { q, status } = req.query;
      const where: Prisma.TenantWhereInput = {};
      if (typeof q === "string" && q.trim()) {
        where.OR = [
          { name: { contains: q.trim(), mode: "insensitive" } },
          { slug: { contains: q.trim(), mode: "insensitive" } },
        ];
      }
      if (status === "ACTIVE" || status === "SUSPENDED") {
        where.status = status;
      }
      const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const tenants = await prisma.tenant.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: {
          id: true, name: true, slug: true, status: true, createdAt: true,
          _count: { select: { users: true, channels: true, conversations: true } },
          mediaAssets: { select: { byteSize: true } },
        },
      });
      const messageCounts = await prisma.message.groupBy({
        by: ["tenantId"],
        where: { createdAt: { gte: cutoff30d } },
        _count: { id: true },
      });
      const msgMap = new Map(messageCounts.map((m) => [m.tenantId, m._count.id]));

      const items: TenantSummary[] = tenants.map((t) => ({
        id: t.id, name: t.name, slug: t.slug, status: t.status,
        createdAt: t.createdAt.toISOString(),
        userCount: t._count.users,
        channelCount: t._count.channels,
        conversationCount: t._count.conversations,
        messageCount30d: msgMap.get(t.id) ?? 0,
        mediaBytes: t.mediaAssets.reduce((s, a) => s + a.byteSize, 0),
      }));
      return res.status(200).json(apiOk({ items }));
    }

    if (req.method === "POST") {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json(apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Payload tidak valid."));
      }
      const { name, ownerEmail, ownerName, ownerPassword } = parsed.data;
      const slug = parsed.data.slug ?? (await generateUniqueSlug());

      const existingTenant = await prisma.tenant.findUnique({ where: { slug } });
      if (existingTenant) {
        return res.status(409).json(apiError("VALIDATION_ERROR", `Slug "${slug}" sudah dipakai.`));
      }
      const existingUser = await prisma.user.findUnique({ where: { email: ownerEmail } });
      if (existingUser) {
        return res.status(409).json(apiError("VALIDATION_ERROR", `Email "${ownerEmail}" sudah terdaftar.`));
      }

      const { tenantId } = await createTenantWithOwner({
        name, slug, ownerEmail, ownerName, ownerPassword,
      });

      await auditAdminAction({
        adminId: admin.adminId, action: "tenant.create",
        targetType: "Tenant", targetId: tenantId,
        afterValue: { name, slug, ownerEmail },
      });

      // Welcome email with the login credentials (owner request 2026-11-10):
      // sent through resolveEmailProvider - the new tenant has no own provider,
      // so this goes via the platform SMTP. A failed/absent provider must
      // never fail the creation; the response tells the admin what happened
      // so credentials can still be relayed manually.
      let welcomeEmailSent = false;
      try {
        const provider = await resolveEmailProvider(tenantId);
        if (provider) {
          const loginUrl = (process.env.DASHBOARD_URL ?? "https://csq-dashboard.onrender.com").replace(/\/$/, "");
          await sendEmailWithProvider(provider, {
            to: ownerEmail,
            subject: "Selamat datang di CSQ",
            text:
              `Halo ${ownerName},\n\n` +
              `Akun CSQ untuk usaha "${name}" sudah dibuat.\n\n` +
              `Masuk di: ${loginUrl}\n` +
              `Email: ${ownerEmail}\n` +
              `Password: ${ownerPassword}\n\n` +
              "Simpan email dan password ini baik-baik untuk masuk ke dashboard CSQ.\n\n" +
              "Jika Anda tidak merasa mendaftar, abaikan email ini.",
          });
          welcomeEmailSent = true;
        }
      } catch {
        welcomeEmailSent = false;
      }

      return res
        .status(201)
        .json(apiOk({ id: tenantId, name, slug, welcomeEmailSent }));
    }

    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed"));

  });
}
