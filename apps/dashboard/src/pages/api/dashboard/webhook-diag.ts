import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requirePermission } from "@csq/core/lib/auth";
import { withSystemContext } from "@csq/core/lib/tenant-context";
import { respondError } from "@csq/core/lib/queries";
import { apiOk, type ApiResponse } from "@csq/core/types/api";

// Owner-only diagnostic read-out for the WhatsApp webhook: the recent
// reasons inbound POSTs were rejected (SIG_MISMATCH / NO_SECRET /
// UNKNOWN_PHONE_ID). Phase 7: the webhook lives in apps/api, so its
// in-memory diagnostics live in THAT process - this route proxies to the
// api's service-token-authed /api/v1/webhook-diag. Memory-only, capped,
// resets on api redeploy - for live diagnosis, not an audit log.

const diagSchema = z.object({
  at: z.string(),
  kind: z.enum(["SIG_MISMATCH", "NO_SECRET", "UNKNOWN_PHONE_ID"]),
  tenantId: z.string().optional(),
  phoneId: z.string().optional(),
  receivedSig: z.string().optional(),
  computedSig: z.string().optional(),
  // Non-owner view (audit run-4): the verdict without the expected sig.
  sigMatch: z.boolean().optional(),
});
const envelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({ items: z.array(diagSchema) }),
});

type Diag = z.infer<typeof diagSchema>;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<{ items: Diag[] }>>
): Promise<void> {
  if (req.method !== "GET") {
    respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
    return;
  }
  const session = await getAuthSession(req, res);
  if (!session) {
    respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
    return;
  }
  if (!requirePermission(session, "webhook.lihat")) {
    respondError(res, "PERMISSION_DENIED", "Hanya owner.");
    return;
  }
  const tenantId = session.user.tenantId;
  if (!tenantId) {
    respondError(res, "PERMISSION_DENIED", "Tenant tidak dikenal.");
    return;
  }

  return withSystemContext(async () => {
    const base = (process.env.API_URL ?? "").replace(/\/$/, "");
    const token = process.env.API_SERVICE_TOKEN ?? "";
    if (!base || !token) {
      respondError(
        res,
        "INTERNAL_ERROR",
        "API_URL / API_SERVICE_TOKEN belum dikonfigurasi."
      );
      return;
    }
    const upstream = await fetch(`${base}/api/v1/webhook-diag`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!upstream.ok) {
      respondError(
        res,
        "INTERNAL_ERROR",
        `Gagal membaca diagnostik (${upstream.status}).`
      );
      return;
    }
    const parsed = envelopeSchema.safeParse(await upstream.json());
    if (!parsed.success) {
      respondError(res, "INTERNAL_ERROR", "Respons diagnostik tidak valid.");
      return;
    }
    // Tenant scoping (audit run-1, webhook-diag-cross-tenant-leak): only
    // entries recorded for THIS tenant's channels. UNKNOWN_PHONE_ID entries
    // (no resolvable tenant) are excluded from tenant views.
    // Audit run-4 (webhook-diag-sig-oracle): computedSig is a 64-bit prefix
    // of HMAC-SHA256(WHATSAPP_APP_SECRET, payload) - a signing oracle for
    // anyone who can feed crafted bodies to the public webhook. Non-owners
    // get the mismatch verdict only, never the expected signature.
    const items = parsed.data.data.items
      .filter((d) => d.tenantId === tenantId)
      .map((d) =>
        session.user.isOwner
          ? d
          : {
              at: d.at,
              kind: d.kind,
              tenantId: d.tenantId,
              phoneId: d.phoneId,
              receivedSig: d.receivedSig,
              sigMatch: d.receivedSig !== undefined && d.receivedSig === d.computedSig,
            }
      );
    res.status(200).json(apiOk({ items }));
  });
}
