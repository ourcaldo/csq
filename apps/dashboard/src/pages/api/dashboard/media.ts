import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { canRunCampaigns } from "@/lib/campaign-access";

// Campaign image upload (plan 3.2.1). Raw-bytes body - the same streaming
// pattern the WhatsApp webhook uses, so no multipart parser and no new
// dependency. Caps: 5 MB per image, mime allow-list (WhatsApp image limits).
// Access: OWNER, or STAFF with the campaign permission.

export type MediaUploadResult = { id: string; url: string };

export const config = { api: { bodyParser: false } };

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function readRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) {
        reject(new Error("IMAGE_TOO_LARGE"));
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
  res: NextApiResponse<ApiResponse<MediaUploadResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);
  if (!canRunCampaigns(session)) {
    return respondError(res, "PERMISSION_DENIED", "Tidak punya izin kampanye.");
  }

  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const rawMime = req.headers["content-type"];
  const mimeType = Array.isArray(rawMime) ? rawMime[0] ?? "" : rawMime ?? "";
  if (!ALLOWED_MIME.has(mimeType)) {
    return respondError(res, "VALIDATION_ERROR", "Format gambar harus JPEG, PNG, atau WebP.");
  }

  let bytes: Buffer;
  try {
    bytes = await readRawBody(req);
  } catch (err) {
    if (err instanceof Error && err.message === "IMAGE_TOO_LARGE") {
      return respondError(res, "VALIDATION_ERROR", "Gambar maksimal 5 MB.");
    }
    return respondError(res, "VALIDATION_ERROR", "Gagal membaca berkas gambar.");
  }
  if (bytes.length === 0) {
    return respondError(res, "VALIDATION_ERROR", "Berkas kosong.");
  }

  const asset = await prisma.mediaAsset.create({
    data: { tenantId, mimeType, byteSize: bytes.length, data: bytes },
  });

  const base = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  const url = `${base}/api/media/${asset.id}`;
  return res.status(201).json(apiOk({ id: asset.id, url }));
}
