import type { NextApiRequest, NextApiResponse } from "next";
import type { Message } from "@prisma/client";
import { z } from "zod";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import { visibleChannelIds, composeChannelIds } from "@csq/core/lib/channel-access";
import prisma from "@csq/core/lib/db";
import {
  HttpError,
  requireTenant,
  respondError,
} from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import {
  CLOUD_API_WINDOW_MS,
  sendHumanReply,
} from "@csq/core/lib/inbox";
import { checkMediaQuota } from "@csq/core/lib/media-quota";

// Inbox media/document send (PRD 24 amendment 2026-11-18). Raw-bytes body -
// the same streaming pattern as the campaign media upload, so no multipart
// parser. The filename rides the query string (?filename=resi.pdf) since the
// body is binary. OWNER + STAFF (same as a text reply, FR-IC-005).

export type MediaSendResult = Message & { senderUserName: string | null };

export const config = { api: { bodyParser: false } };

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_DOC_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
]);

// Audit run-3: raster-only image allow-list - image/svg+xml is a script-
// executing document, not a displayable image.
const INLINE_SAFE_IMAGES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function readRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        reject(new Error("MEDIA_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const filenameSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[^/\\]+$/, "filename must not contain path separators");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<MediaSendResult>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (!requirePermission(session, "inbox.media")) {
      return respondError(
        res,
        "PERMISSION_DENIED",
        "Hanya owner atau staff yang dapat mengirim."
      );
    }
    if (req.method !== "POST") {
      return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
    }

    const { id } = req.query;
    if (typeof id !== "string") {
      return respondError(res, "VALIDATION_ERROR", "ID percakapan tidak valid.");
    }
    // Optional caption rides the header (body is the raw file bytes); the
    // client percent-encodes it so the header stays ASCII-safe.
    const captionRaw = req.headers["x-caption"];
    const captionEncoded =
      (Array.isArray(captionRaw) ? captionRaw[0] : captionRaw) ?? "";
    let caption = "";
    if (captionEncoded) {
      try {
        caption = decodeURIComponent(captionEncoded).slice(0, 4096);
      } catch {
        return respondError(res, "VALIDATION_ERROR", "Caption tidak valid.");
      }
    }
    const filenameRaw = req.query.filename;
    const parsedFilename = filenameSchema.safeParse(
      Array.isArray(filenameRaw) ? filenameRaw[0] : filenameRaw
    );
    if (!parsedFilename.success) {
      return respondError(res, "VALIDATION_ERROR", "Nama berkas tidak valid.");
    }

    const rawMime = req.headers["content-type"];
    const mimeType = Array.isArray(rawMime) ? rawMime[0] ?? "" : rawMime ?? "";
    const isDocument = !mimeType.startsWith("image/");
    // Audit run-3 (media.inline-svg-any-user-bytes): the image allow-list is
    // the raster set, not bare image/* - image/svg+xml must never be stored
    // (it executes script when the media URL is opened directly).
    if (
      (!mimeType.startsWith("image/") || !INLINE_SAFE_IMAGES.has(mimeType)) &&
      !ALLOWED_DOC_MIME.has(mimeType)
    ) {
      return respondError(
        res,
        "VALIDATION_ERROR",
        "Format berkas tidak didukung."
      );
    }

    let bytes: Buffer;
    try {
      bytes = await readRawBody(req);
    } catch (err) {
      if (err instanceof Error && err.message === "MEDIA_TOO_LARGE") {
        return respondError(res, "VALIDATION_ERROR", "Berkas maksimal 10 MB.");
      }
      return respondError(res, "VALIDATION_ERROR", "Gagal membaca berkas.");
    }
    if (bytes.length === 0) {
      return respondError(res, "VALIDATION_ERROR", "Berkas kosong.");
    }

    try {
      // 24h window check BEFORE storing the asset - a blocked send must not
      // leak an orphaned MediaAsset (Cloud API only, same rule as a text
      // reply). Baileys has no window.
      // PRD 29 section 6: only conversations on visible channels.
      const visibleCh = await visibleChannelIds(session);
      const channelScope = visibleCh ? { channelId: { in: visibleCh } } : {};
      const conv = await prisma.conversation.findFirst({
        where: { id, tenantId, ...channelScope },
        include: { channel: true },
      });
      if (!conv) {
        return respondError(res, "NOT_FOUND", "Percakapan tidak ditemukan.");
      }
      // Audit run-4 (kirim-grant-unenforced): KIRIM gates the actual send.
      const composeSet = await composeChannelIds(session);
      if (composeSet !== null && !composeSet.includes(conv.channelId)) {
        return respondError(res, "PERMISSION_DENIED", "Tidak punya izin mengirim di saluran ini.");
      }
      if (conv.channel.provider === "CLOUD_API") {
        const lastInbound = await prisma.message.findFirst({
          where: { conversationId: id, direction: "INBOUND" },
          orderBy: { createdAt: "desc" },
        });
        const withinWindow =
          !!lastInbound &&
          Date.now() - lastInbound.createdAt.getTime() <= CLOUD_API_WINDOW_MS;
        if (!withinWindow) {
          return respondError(
            res,
            "VALIDATION_ERROR",
            "Jendela 24 jam telah tutup. Gunakan template yang disetujui untuk pesan proaktif."
          );
        }
      }

      // Store only once the send is allowed, then send through the same
      // sendHumanReply pipeline as a typed reply (outbox, audit).
      // `isDocument` is not passed further: the worker routes on the asset's
      // mime (image/* -> image send, else document).
      // PRD 14 amendment 2026-11-28 item 7: total media bytes per plan.
      const quota = await checkMediaQuota(tenantId, bytes.length);
      if (!quota.allowed) {
        return respondError(
          res,
          "PERMISSION_DENIED",
          "Kuota penyimpanan media paket habis. Hapus media lama atau upgrade paket."
        );
      }
      const asset = await prisma.mediaAsset.create({
        data: { tenantId, mimeType, byteSize: bytes.length, data: bytes },
      });
      const message = await sendHumanReply({
        conversationId: id,
        tenantId,
        userId: session.user.id,
        body: caption,
        ...(isDocument
          ? { mediaId: asset.id, filename: parsedFilename.data }
          : { mediaId: asset.id }),
      });
      const enriched = {
        ...message,
        senderUserName: session.user.name ?? session.user.email ?? null,
      };
      return res.status(201).json(apiOk(enriched));
    } catch (err) {
      if (err instanceof HttpError) {
        return respondError(res, err.code, err.message);
      }
      return respondError(res, "INTERNAL_ERROR", "Gagal mengirim berkas.");
    }
  });
}
