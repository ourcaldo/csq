import prisma from "@csq/core/lib/db";
import { HttpError } from "@csq/core/lib/queries";
import { parseFile, MAX_IMPORT_ROWS } from "@csq/core/services/excel";
import { contactCreateSchema } from "@csq/core/types/contact";
import type { z } from "zod";

// Phone normalization shared by the single add and the bulk import: strip
// non-digits, 08xx -> 628xx (same rule as createLead in inbox.ts).
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  const phone = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  if (phone.length < 8 || phone.length > 20) {
    throw new HttpError("VALIDATION_ERROR", "Nomor WhatsApp tidak valid.");
  }
  return phone;
}

// One validated row from the import file.
export type ImportRow = z.infer<typeof contactCreateSchema> & { phone: string };

export type ImportResult = {
  created: number;
  skipped: number;
  errors: string[];
};

// Header aliases accepted for each column (case-insensitive contains).
const COLUMN_ALIASES: Record<string, string[]> = {
  phone: ["phone", "nomor", "no hp", "whatsapp", "wa", "telepon", "no wa"],
  name: ["name", "nama"],
  email: ["email"],
  notes: ["note", "notes", "catatan", "keterangan"],
};

function matchColumn(headers: string[], field: string): string | null {
  const aliases = COLUMN_ALIASES[field];
  const lower = headers.map((h) => h.toLowerCase());
  for (const alias of aliases) {
    const idx = lower.findIndex((h) => h.includes(alias));
    if (idx >= 0) return headers[idx];
  }
  return null;
}

// Bulk contact import (owner request 2026-11-18). Reuses parseFile (Excel/CSV,
// 10k row cap) so the transport and guard match the product import. Rows are
// validated one by one; a phone already in the file or in the DB is skipped,
// never duplicated (tenantId+phone unique). Partial success by design - the
// owner sees created/skipped plus the first errors.
export async function importContacts(
  tenantId: string,
  filename: string,
  base64: string
): Promise<ImportResult> {
  const { headers, rows } = await parseFile(Buffer.from(base64, "base64"), filename);
  const phoneCol = matchColumn(headers, "phone");
  if (!phoneCol) {
    throw new HttpError(
      "VALIDATION_ERROR",
      "Kolom nomor telepon tidak ditemukan. Gunakan header seperti phone, nomor, atau no hp."
    );
  }
  const nameCol = matchColumn(headers, "name");
  const emailCol = matchColumn(headers, "email");
  const notesCol = matchColumn(headers, "notes");

  const seen = new Set<string>();
  const batch: ImportRow[] = [];
  let skipped = 0;
  const errors: string[] = [];

  rows.forEach((row, i) => {
    const line = i + 2; // 1-based + header row, for error messages
    // Spreadsheet cells that ExcelJS parsed as numbers lost a leading zero:
    // CSV "08123..." arrives as the number 8123... Recover the Indonesian
    // local format: a numeric cell starting with 8 was typed as 08xx.
    const phoneCell = row[phoneCol];
    const raw = String(phoneCell ?? "").trim();
    if (!raw) {
      skipped++;
      return;
    }
    const phoneInput =
      typeof phoneCell === "number" && raw.startsWith("8") ? `0${raw}` : raw;
    const parsed = contactCreateSchema.safeParse({
      phone: phoneInput,
      ...(nameCol && String(row[nameCol] ?? "").trim()
        ? { name: String(row[nameCol]).trim() }
        : {}),
      ...(emailCol && String(row[emailCol] ?? "").trim()
        ? { email: String(row[emailCol]).trim() }
        : {}),
      ...(notesCol && String(row[notesCol] ?? "").trim()
        ? { notes: String(row[notesCol]).trim() }
        : {}),
    });
    if (!parsed.success) {
      skipped++;
      if (errors.length < 10) {
        errors.push(`Baris ${line}: nomor "${phoneInput.slice(0, 25)}" tidak valid.`);
      }
      return;
    }
    let phone: string;
    try {
      phone = normalizePhone(parsed.data.phone);
    } catch {
      skipped++;
      if (errors.length < 10) {
        errors.push(`Baris ${line}: nomor "${phoneInput.slice(0, 25)}" tidak valid.`);
      }
      return;
    }
    if (seen.has(phone)) {
      skipped++;
      return;
    }
    seen.add(phone);
    batch.push({ ...parsed.data, phone });
  });

  if (batch.length > MAX_IMPORT_ROWS) {
    throw new HttpError("VALIDATION_ERROR", "Impor maksimal 10.000 baris.");
  }

  let created = 0;
  if (batch.length > 0) {
    // Skip numbers that already exist (dedupe without failing the batch).
    const existing = await prisma.contact.findMany({
      where: { tenantId, phone: { in: batch.map((r) => r.phone) } },
      select: { phone: true },
    });
    const existingSet = new Set(existing.map((c) => c.phone));
    const fresh = batch.filter((r) => {
      if (existingSet.has(r.phone)) {
        skipped++;
        return false;
      }
      return true;
    });
    if (fresh.length > 0) {
      await prisma.contact.createMany({
        data: fresh.map((r) => ({
          tenantId,
          phone: r.phone,
          ...(r.name ? { name: r.name } : {}),
          ...(r.email ? { email: r.email } : {}),
          ...(r.notes ? { notes: r.notes } : {}),
          source: "Import Kontak",
        })),
      });
      created = fresh.length;
    }
  }

  return { created, skipped, errors };
}
