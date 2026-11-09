import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { parseFile, applyMappingWithStats } from "@csq/core/services/excel";
import { excelConfirmSchema } from "@csq/core/types/import";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { replaceSourceRows } from "@csq/core/lib/source-rows";
import { applyImport } from "@csq/core/lib/import-apply";

type ConfirmResponse = { imported: number; dataSourceId: string };

// Step 2: owner has confirmed. Re-parse the file and record an EXCEL DataSource.
// Only dataType "produk" gets structured product/inventory import via applyImport
// (G8: writes per-source InventorySnapshot + recomputes canonical Inventory by
// Tenant.settings.sourcePriority, atomically in one transaction). Any other type
// (cabang, staff, etc.) is stored as raw rows in SourceRow for source.search -
// no product upsert, no mapping required. Tenant from session only.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ConfirmResponse>>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json(apiError("INTERNAL_ERROR", "Method not allowed"));
  }

  const session = await getAuthSession(req, res);
  if (!session) return res.status(401).json(apiError("UNAUTHORIZED", "Masuk dulu."));

  // SEC-2 (PRD 16): business-data imports and Google connections are
  // OWNER-only (PRD 18.1).
  if (!requireRole(session, "OWNER")) {
    return res.status(403).json(apiError("PERMISSION_DENIED", "Hanya owner yang dapat mengubah data bisnis."));
  }
  const parsed = excelConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input"));
  }

  const { filename, base64, mapping } = parsed.data;
  const dataType = (parsed.data.dataType ?? "produk").trim().toLowerCase();
  const isProduct = dataType === "produk";
  if (isProduct && !mapping) {
    return res.status(400).json(apiError("VALIDATION_ERROR", "Mapping kolom diperlukan untuk tipe data produk."));
  }
  const tenantId = session.user.tenantId;

  return withTenantContext(tenantId, async () => {
    const { rows } = await parseFile(Buffer.from(base64, "base64"), filename);
    const { products, skipped } = isProduct && mapping ? applyMappingWithStats(rows, mapping) : { products: [], skipped: 0 };

    const dataSource = await prisma.dataSource.create({
      data: {
        tenantId,
        type: "EXCEL",
        name: filename,
        dataType,
        config: { filename, mapping: mapping ?? null, dataType },
        status: "ACTIVE",
        lastSyncAt: new Date(),
      },
    });

    let imported = 0;
    if (isProduct) {
      // C2: route through applyImport so Excel writes InventorySnapshot + uses
      // source-priority resolution (G8), matching the Sheets path. The import is
      // atomic; skipped counts Zod-rejected rows (here) + batch dedup (inside).
      const summary = await applyImport(tenantId, products, "EXCEL", filename);
      imported = summary.created + summary.updated;
      // Surface skipped rows in the server log so the owner can diagnose drops
      // even though the response shape carries only the imported count.
      if (skipped > 0 || (summary.skipped ?? 0) > 0) {
        console.info(`[excel import] ${filename}: imported=${imported}, zod-skipped=${skipped}, dedup-skipped=${summary.skipped ?? 0}, errors=${summary.errors.length}`);
      }
    } else {
      imported = rows.length;
    }

    // Persist the full parsed rows (all columns) so source.search can read
    // inside the uploaded file - not just the five mapped product fields.
    await replaceSourceRows(tenantId, dataSource.id, rows);

    return res.status(201).json(apiOk({ imported, dataSourceId: dataSource.id }));
  });
}
