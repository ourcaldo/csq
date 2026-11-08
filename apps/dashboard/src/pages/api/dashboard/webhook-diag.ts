import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireRole } from "@csq/core/lib/auth";
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
  phoneId: z.string().optional(),
  receivedSig: z.string().optional(),
  computedSig: z.string().optional(),
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
  if (!requireRole(session, "OWNER")) {
    respondError(res, "PERMISSION_DENIED", "Hanya owner.");
    return;
  }

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
  res.status(200).json(apiOk({ items: parsed.data.data.items }));
}
