import { z } from "zod";
import type { ToolDefinition, ToolResult } from "@/types/tools";

// source.* tools. source.search lets the CS agent read INSIDE the imported
// sumber data (Excel/Google Sheets) — every column, not just the five mapped
// product fields (name/price/quantity/sku/description). It searches the stored
// SourceRow rows (populated on import and each sync by lib/source-rows) for rows
// whose cell values contain the query, and returns the matching rows with all
// their columns so the agent can answer from info the owner loaded.
//
// Read-only and allowed by default: the agent only looks up information the
// owner imported; it can never edit the source. Tenant-scoped (the query filters
// by tenantId), and only ACTIVE sources are searched — disconnected/disabled
// sources' rows are skipped so the agent doesn't quote stale data.

const sourceSearchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
});
type SourceSearchParams = z.infer<typeof sourceSearchSchema>;

// Raw SQL result row — external boundary, parsed with Zod (never `as`). `data` is
// selected as text and JSON.parsed so the shape is deterministic regardless of
// how the driver returns JSONB.
const rawRowSchema = z.object({
  dataSourceId: z.string(),
  sourceName: z.string(),
  rowIndex: z.number(),
  dataText: z.string(),
});

// The parsed row payload — a flat { column: value } record. Zod-parsed so we
// never `as` the JSON.parse result.
const rowDataSchema = z.record(z.unknown());

type SerializedMatch = {
  source: string;
  row: Record<string, unknown>;
};

const sourceSearch: ToolDefinition<SourceSearchParams> = {
  name: "source.search",
  description:
    "Cari di dalam data sumber (Excel/Google Sheets yang sudah diimpor pemilik) — semua kolom, bukan hanya produk. Pakai saat pelanggan bertanya info yang mungkin ada di spreadsheet toko tetapi bukan field produk standar (mis. kategori, berat, catatan, supplier). Mengembalikan baris yang cocok dengan semua kolomnya.",
  category: "source",
  parameters: sourceSearchSchema,
  defaultPermission: { allowed: true, requiresApproval: false },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    const limit = p.limit ?? 20;

    // Tenant-scoped, DB-side substring search over the stored rows' JSON. Only
    // ACTIVE sources are searched. Parameterized — no string interpolation of
    // user input (prompt-injection / SQL-injection safe).
    const rows = await ctx.prisma.$queryRaw<
      Array<{ dataSourceId: string; sourceName: string; rowIndex: number; dataText: string }>
    >`
      SELECT sr."dataSourceId", ds.name AS "sourceName", sr."rowIndex", sr.data::text AS "dataText"
      FROM "SourceRow" sr
      JOIN "DataSource" ds ON ds.id = sr."dataSourceId"
      WHERE sr."tenantId" = ${ctx.tenantId}
        AND ds.status = 'ACTIVE'
        AND sr.data::text ILIKE '%' || ${p.query} || '%'
      ORDER BY sr."dataSourceId", sr."rowIndex"
      LIMIT ${limit}
    `;

    const matches: SerializedMatch[] = [];
    for (const raw of rows) {
      const parsed = rawRowSchema.safeParse(raw);
      if (!parsed.success) continue;
      let row: Record<string, unknown> = {};
      try {
        const rowParsed = rowDataSchema.safeParse(JSON.parse(parsed.data.dataText));
        if (rowParsed.success) row = rowParsed.data;
      } catch {
        row = {};
      }
      matches.push({ source: parsed.data.sourceName, row });
    }

    await ctx.audit({
      action: "source.search",
      entityType: "source",
      entityId: p.query,
    });

    if (matches.length === 0) {
      return {
        success: true,
        data: { matches: [], message: "Tidak ada baris yang cocok di sumber data." },
      };
    }
    return { success: true, data: { matches } };
  },
};

export const sourceTools: ToolDefinition<any>[] = [sourceSearch];
