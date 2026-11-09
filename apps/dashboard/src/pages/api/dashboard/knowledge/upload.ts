import type { NextApiRequest, NextApiResponse } from "next";
import type { Knowledge } from "@prisma/client";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { logHuman } from "@csq/core/lib/audit";
import { requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { knowledgeUploadSchema } from "@csq/core/types/knowledge";
import { upsertEmbedding } from "@csq/core/lib/vector";
import { embed, isEmbeddingsConfigured } from "@csq/core/services/embeddings";
import {
  extractDocumentText,
  MIME_DOCX,
  MIME_PDF,
} from "@csq/core/services/document-extract";

// FEA-1 (PRD 16): knowledge document upload (PDF/DOCX). The file arrives as
// base64 JSON like the Excel import, so the body parser limit is raised to fit
// a 10 MB document (~13.7 MB base64) plus JSON overhead.
export const config = { api: { bodyParser: { sizeLimit: "15mb" } } };

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

// Derive the mime from the file name extension server-side; a client-declared
// mime is never trusted for the parser choice. Unknown extensions fall through
// and the extractor rejects them.
function mimeFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return MIME_PDF;
  if (lower.endsWith(".docx")) return MIME_DOCX;
  return "";
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<Knowledge>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  return withTenantContext(tenantId, async () => {
    if (req.method !== "POST") {
      return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
    }

    if (!requireRole(session, "OWNER")) {
      return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengunggah dokumen.");
    }

    const parsed = knowledgeUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      return respondError(res, "VALIDATION_ERROR", parsed.error.message);
    }

    const { filename, base64, title } = parsed.data;
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length === 0) {
      return respondError(res, "VALIDATION_ERROR", "Berkas kosong.");
    }
    if (bytes.length > MAX_DOCUMENT_BYTES) {
      return respondError(res, "VALIDATION_ERROR", "Dokumen maksimal 10 MB.");
    }
    const mime = mimeFromFilename(filename);
    if (!mime) {
      return respondError(res, "VALIDATION_ERROR", "Tipe dokumen tidak didukung. Gunakan PDF atau DOCX.");
    }

    let content: string;
    try {
      content = await extractDocumentText({ mime, bytes });
    } catch (err) {
      return respondError(
        res,
        "VALIDATION_ERROR",
        err instanceof Error ? err.message : "Gagal membaca dokumen."
      );
    }

    // Uploaded documents map to POLICY: it is the closest existing
    // KnowledgeType (the demo's return/shipping policy PDFs are policies).
    const fallbackTitle = filename.replace(/\.[^.]+$/, "");
    const knowledge = await prisma.knowledge.create({
      data: {
        tenantId,
        type: "POLICY",
        title: title ?? (fallbackTitle || filename),
        content,
        sourceName: filename,
        mimeType: mime,
      },
    });
    await logHuman({
      tenantId,
      action: "knowledge.upload",
      entityType: "Knowledge",
      entityId: knowledge.id,
      afterValue: knowledge,
    });
    // Same best-effort embedding path as knowledge/create.ts so the extracted
    // text is retrievable via knowledge.search.
    if (isEmbeddingsConfigured()) {
      try {
        const vec = await embed(`${knowledge.title}\n${knowledge.content}`);
        await upsertEmbedding("KnowledgeEmbedding", knowledge.id, tenantId, vec);
      } catch (err) {
        console.warn(
          `[knowledge.upload] embedding upsert skipped for ${knowledge.id}:`,
          err
        );
      }
    }
    return res.status(201).json(apiOk(knowledge));
  });
}
