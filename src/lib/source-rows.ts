import { Prisma } from "@prisma/client";
import prisma from "@/lib/db";

// Persists the full parsed rows of an Excel/Google Sheets source so the agent
// can read inside the sumber data via the `source.search` tool — every column,
// not just the five mapped product fields. Called on import and on each sync.
//
// Replaces (delete + re-insert) so the stored rows stay in sync with the source.
// Insert is batched (createMany in chunks) so a large sheet doesn't build one
// giant SQL statement. Rows are tenant-scoped via the source's tenantId; the
// `data` column holds the row as { column: value }.

const BATCH_SIZE = 500;

// Coerce a row record to a Prisma InputJsonValue for the `data` column without
// a type assertion — same JSON round-trip pattern as toJson in tools/execute.ts.
function toJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v));
}

type CreateRowInput = {
  tenantId: string;
  dataSourceId: string;
  rowIndex: number;
  data: Prisma.InputJsonValue;
};

export async function replaceSourceRows(
  tenantId: string,
  dataSourceId: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  // M10: wrap delete + re-insert in a single transaction so a crash mid-replace
  // can't leave SourceRow empty/partial — the whole replace is atomic.
  await prisma.$transaction(async (tx) => {
    await tx.sourceRow.deleteMany({ where: { tenantId, dataSourceId } });

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const slice = rows.slice(i, i + BATCH_SIZE);
      const data: CreateRowInput[] = slice.map((row, j) => ({
        tenantId,
        dataSourceId,
        rowIndex: i + j,
        data: toJson(row),
      }));
      if (data.length > 0) {
        await tx.sourceRow.createMany({ data });
      }
    }
  });
}
