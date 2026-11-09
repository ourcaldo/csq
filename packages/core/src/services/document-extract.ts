import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

// FEA-1 (PRD 16): server-side text extraction for uploaded knowledge
// documents. One module for the whole document-parsing integration: PDF via
// pdf-parse (v2 typed API), DOCX via mammoth. Server-only; the bytes never
// reach the browser. pdf-parse v2 ships its own types, so no ambient shim is
// needed, and it has no v1 debug-mode import quirk.

export const MIME_PDF = "application/pdf";
export const MIME_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function extractDocumentText(input: {
  mime: string;
  bytes: Buffer;
}): Promise<string> {
  let raw: string;
  if (input.mime === MIME_PDF) {
    const parser = new PDFParse({ data: input.bytes });
    try {
      // pageJoiner "\n": join pages with a newline instead of the default
      // "-- n of m --" markers, which would pollute the stored content.
      const result = await parser.getText({ pageJoiner: "\n" });
      raw = result.text;
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  } else if (input.mime === MIME_DOCX) {
    const result = await mammoth.extractRawText({ buffer: input.bytes });
    raw = result.value;
  } else {
    throw new Error("Tipe dokumen tidak didukung. Gunakan PDF atau DOCX.");
  }
  // Collapse runs of spaces/tabs and 3+ newlines; keep paragraph breaks.
  const text = raw
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) {
    throw new Error("Dokumen tidak berisi teks yang bisa dibaca.");
  }
  return text;
}
