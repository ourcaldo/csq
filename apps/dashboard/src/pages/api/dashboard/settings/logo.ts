import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { logHuman } from "@csq/core/lib/audit";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

// Business logo upload (PRD 28 follow-up, /dashboard/pengaturan/umum).
// OWNER-only. Raw-bytes body (same pattern as the channels media upload -
// no multipart parser, no new dependency). Caps: 2 MB, image allow-list.
// The asset id persists in Tenant.settings.logoMediaId; DELETE clears it.
// Serving rides the authenticated /api/dashboard/media/[id] route.

export const config = { api: { bodyParser: false } };

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function readRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_LOGO_BYTES) {
        reject(new Error("LOGO_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ logoUrl: string | null }>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requirePermission(session, "pengaturan.kelola")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengubah logo usaha.");
  }
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method === "POST") {
      const rawMime = req.headers["content-type"];
      const mimeType = Array.isArray(rawMime) ? rawMime[0] ?? "" : rawMime ?? "";
      if (!ALLOWED_MIME.has(mimeType)) {
        return respondError(res, "VALIDATION_ERROR", "Logo harus JPEG, PNG, atau WebP.");
      }
      let bytes: Buffer;
      try {
        bytes = await readRawBody(req);
      } catch (err) {
        if (err instanceof Error && err.message === "LOGO_TOO_LARGE") {
          return respondError(res, "VALIDATION_ERROR", "Logo maksimal 2 MB.");
        }
        return respondError(res, "VALIDATION_ERROR", "Gagal membaca berkas logo.");
      }
      if (bytes.length === 0) {
        return respondError(res, "VALIDATION_ERROR", "Berkas kosong.");
      }

      const asset = await prisma.mediaAsset.create({
        data: { tenantId, mimeType, byteSize: bytes.length, data: bytes },
      });

      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      const settings = {
        ...((tenant?.settings as Record<string, unknown> | null) ?? {}),
        logoMediaId: asset.id,
      };
      await prisma.tenant.update({ where: { id: tenantId }, data: { settings } });
      await logHuman({
        actorEmail: session.user.email ?? undefined,
        tenantId,
        action: "settings.logo_updated",
        entityType: "Tenant",
        entityId: tenantId,
        afterValue: { logoMediaId: asset.id },
      });
      return res
        .status(201)
        .json(apiOk({ logoUrl: `/api/dashboard/media/${asset.id}` }));
    }

    if (req.method === "DELETE") {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      const settings = {
        ...((tenant?.settings as Record<string, unknown> | null) ?? {}),
      };
      delete settings.logoMediaId;
      await prisma.tenant.update({ where: { id: tenantId }, data: { settings } });
      await logHuman({
        actorEmail: session.user.email ?? undefined,
        tenantId,
        action: "settings.logo_cleared",
        entityType: "Tenant",
        entityId: tenantId,
      });
      return res.status(200).json(apiOk({ logoUrl: null }));
    }

    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  });
}
