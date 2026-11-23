import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import { importContacts } from "@csq/core/lib/contacts";
import { HttpError, requireTenant, respondError } from "@csq/core/lib/queries";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { logHuman } from "@csq/core/lib/audit";
import { apiOk, type ApiResponse } from "@csq/core/types/api";
import { contactImportSchema } from "@csq/core/types/contact";

type ImportResponse = { created: number; skipped: number; errors: string[] };

// Bulk contact import (owner request 2026-11-18): Excel/CSV via the same
// base64 transport as the product import. OWNER-only (business-data writes,
// same rule as product import). Partial success: created/skipped + first
// row-level errors come back so the owner can fix the file.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<ImportResponse>>
) {
  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requirePermission(session, "kontak.kelola")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengimpor kontak.");
  }
  const tenantId = requireTenant(session);

  const parsed = contactImportSchema.safeParse(req.body);
  if (!parsed.success) {
    return respondError(res, "VALIDATION_ERROR", parsed.error.message);
  }
  const { filename, base64 } = parsed.data;

  try {
    return await withTenantContext(tenantId, async () => {
      const result = await importContacts(tenantId, filename, base64);
      if (result.created > 0) {
        await logHuman({
          tenantId,
          action: "contact.import",
          entityType: "Contact",
          entityId: filename,
          afterValue: { created: result.created, skipped: result.skipped },
        });
      }
      return res.status(200).json(apiOk(result));
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return respondError(res, err.code, err.message);
    }
    if (err instanceof Error && err.name === "ImportTooLargeError") {
      return respondError(res, "VALIDATION_ERROR", err.message);
    }
    return respondError(res, "INTERNAL_ERROR", "Gagal mengimpor kontak.");
  }
}
