import { Workbook } from "exceljs";
import { Readable } from "stream";
import { z } from "zod";

// Excel/CSV ingestion service (PRD §8.2). One module per integration; server-only.
// Reads .xlsx/.xls via exceljs.xlsx.load and .csv via exceljs.csv.read, detects
// columns using Indonesian/English heuristics, and maps rows to product records.
// Parsed rows are Zod-validated at this boundary (no `as`); invalid rows are
// dropped so corrupt cells never reach the import applier.

const FIELD_KEYWORDS: Record<string, string[]> = {
  name: ["nama barang", "nama produk", "produk", "product", "name", "nama"],
  price: ["harga jual", "harga", "price", "biaya"],
  quantity: ["stok", "stock", "sisa", "qty", "quantity", "jumlah"],
  sku: ["sku", "kode", "code"],
  description: ["deskripsi", "description", "keterangan"],
};

const FIELD_ORDER = Object.keys(FIELD_KEYWORDS);

export type ParsedSheet = {
  headers: string[];
  rows: Record<string, unknown>[];
};

export type ColumnMapping = Record<string, string | null>;

export type MappedProduct = {
  name: string;
  sku?: string;
  price: number;
  description?: string;
  stock?: number;
};

// Zod schema for a mapped product row. Coercion handles spreadsheet cells that
// arrive as strings (e.g. "85000" → 85000). Invalid rows are rejected here.
export const mappedProductSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional(),
  price: z.coerce.number().min(0),
  description: z.string().optional(),
  stock: z.coerce.number().int().min(0).optional(),
});


export async function parseFile(buffer: Buffer, filename: string): Promise<ParsedSheet> {
  const wb = new Workbook();
  const lower = filename.toLowerCase();
  // Stream the buffer into exceljs via Readable.from rather than xlsx.load(Buffer):
  // exceljs's bundled types reference the pre-@types/node-22 non-generic Buffer,
  // so a Buffer<ArrayBufferLike> arg fails the type check. Streaming avoids the
  // mismatch and matches the CSV path below.
  if (lower.endsWith(".csv")) {
    await wb.csv.read(Readable.from(buffer));
  } else {
    await wb.xlsx.read(Readable.from(buffer));
  }

  const sheet = wb.worksheets[0];
  if (!sheet || sheet.rowCount === 0) return { headers: [], rows: [] };

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell, colNumber) => {
    const value = String(cell.value ?? "").trim();
    if (value) headers[colNumber - 1] = value;
  });

  const rows: Record<string, unknown>[] = [];
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const obj: Record<string, unknown> = {};
    row.eachCell((cell, colNumber) => {
      const key = headers[colNumber - 1] ?? `col${colNumber}`;
      obj[key] = cell.value;
    });
    rows.push(obj);
  });

  return { headers: headers.filter(Boolean), rows };
}

export function detectColumns(headers: string[]): {
  mapping: ColumnMapping;
  confidence: number;
  fieldConfidence: Record<string, number>;
} {
  const mapping: ColumnMapping = {};
  const fieldConfidence: Record<string, number> = {};
  let total = 0;
  for (const field of FIELD_ORDER) {
    const keywords = FIELD_KEYWORDS[field];
    let bestHeader: string | null = null;
    let bestIdx = -1;
    for (let i = 0; i < keywords.length; i++) {
      const found = headers.find((h) => h.toLowerCase().includes(keywords[i]));
      if (found) {
        bestHeader = found;
        bestIdx = i;
        break;
      }
    }
    mapping[field] = bestHeader;
    // Per-field confidence: earlier keyword match = higher confidence (1.0 for
    // the first keyword, stepping down 0.2 per rank, floor 0.2); no match = 0.
    const score = bestIdx >= 0 ? Math.max(0.2, 1 - bestIdx * 0.2) : 0;
    fieldConfidence[field] = score;
    total += score;
  }
  return { mapping, confidence: total / FIELD_ORDER.length, fieldConfidence };
}

export function applyMapping(rows: Record<string, unknown>[], mapping: ColumnMapping): MappedProduct[] {
  const products: MappedProduct[] = [];
  for (const row of rows) {
    const name = mapping.name ? String(row[mapping.name] ?? "").trim() : "";
    if (!name) continue;
    const skuRaw = mapping.sku ? row[mapping.sku] : undefined;
    const descRaw = mapping.description ? row[mapping.description] : undefined;
    const candidate = {
      name,
      sku: skuRaw != null && String(skuRaw).trim() ? String(skuRaw).trim() : undefined,
      price: mapping.price ? row[mapping.price] : 0,
      description:
        descRaw != null && String(descRaw).trim() ? String(descRaw).trim() : undefined,
      stock: mapping.quantity ? row[mapping.quantity] : undefined,
    };
    // Zod-validate at the parsed-row boundary; drop rows that fail.
    const parsed = mappedProductSchema.safeParse(candidate);
    if (parsed.success) {
      products.push(parsed.data);
    }
  }
  return products;
}

