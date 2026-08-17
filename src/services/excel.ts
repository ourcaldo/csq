import { Workbook } from "exceljs";
import { Readable } from "stream";

// Excel/CSV ingestion service (PRD §8.2). One module per integration; server-only.
// Reads .xlsx/.xls via exceljs.xlsx.load and .csv via exceljs.csv.read, detects
// columns using Indonesian/English heuristics, and maps rows to product records.

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

export function detectColumns(headers: string[]): { mapping: ColumnMapping; confidence: number } {
  const mapping: ColumnMapping = {};
  let matched = 0;
  for (const field of FIELD_ORDER) {
    const found = headers.find((h) =>
      FIELD_KEYWORDS[field].some((kw) => h.toLowerCase().includes(kw))
    );
    mapping[field] = found ?? null;
    if (found) matched++;
  }
  return { mapping, confidence: matched / FIELD_ORDER.length };
}

export function applyMapping(rows: Record<string, unknown>[], mapping: ColumnMapping): MappedProduct[] {
  return rows
    .map((row) => {
      const name = mapping.name ? String(row[mapping.name] ?? "").trim() : "";
      const priceRaw = mapping.price ? row[mapping.price] : undefined;
      const stockRaw = mapping.quantity ? row[mapping.quantity] : undefined;
      const skuRaw = mapping.sku ? row[mapping.sku] : undefined;
      const descRaw = mapping.description ? row[mapping.description] : undefined;
      return {
        name,
        sku: skuRaw != null && String(skuRaw).trim() ? String(skuRaw).trim() : undefined,
        price: priceRaw != null ? Number(priceRaw) || 0 : 0,
        description: descRaw != null && String(descRaw).trim() ? String(descRaw).trim() : undefined,
        stock: stockRaw != null ? Number(stockRaw) || 0 : undefined,
      };
    })
    .filter((p) => p.name.length > 0);
}
