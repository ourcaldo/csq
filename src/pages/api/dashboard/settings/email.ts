import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireRole } from "@/lib/auth";
import { logHuman } from "@/lib/audit";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import {
  emailProviderSchema,
  getEmailProvider,
  saveEmailProvider,
  clearEmailProvider,
  maskEmailProvider,
  type EmailProviderStatus,
} from "@/lib/email-config";

// Per-tenant email delivery config for the scenario Email module (Settings →
// Email). The owner brings their own provider: SMTP (host/port/user/pass) or
// Resend (API key). Stored in Tenant.settings.emailProvider through
// src/lib/email-config.ts — the single source of truth for the shape.
//
// OWNER-only for every method: the config contains credentials, and delivery
// setup is a tenant-wide owner decision (same boundary as source priority).
// GET never returns the secret — only masked status flags.

// Input shape for the PUT. `port` arrives as a string from HTML forms —
// coerce to int at the boundary. The secret (password/apiKey) may be omitted
// to KEEP the stored one (owner editing only the sender or host shouldn't
// have to re-enter the credential); it is required when no same-type config
// exists yet. The merged result is re-validated against the stored schema so
// exactly one shape is persisted.
const emailProviderInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("SMTP"),
    host: z.string().min(1).max(255),
    port: z.coerce.number().int().min(1).max(65535),
    secure: z.boolean(),
    username: z.string().max(255),
    password: z.string().max(255).optional(),
    from: z.string().min(3).max(320),
  }),
  z.object({
    type: z.literal("RESEND"),
    apiKey: z.string().max(255).optional(),
    from: z.string().min(3).max(320),
  }),
]);

type EmailStatusResponse = { configured: false } | EmailProviderStatus;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<EmailStatusResponse>>
) {
  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(
      res,
      "PERMISSION_DENIED",
      "Hanya owner yang dapat mengatur integrasi email."
    );
  }
  const tenantId = requireTenant(session);

  if (req.method === "GET") {
    const provider = await getEmailProvider(tenantId);
    return res
      .status(200)
      .json(apiOk(provider ? maskEmailProvider(provider) : { configured: false }));
  }

  if (req.method === "PUT") {
    const input = emailProviderInputSchema.safeParse(req.body);
    if (!input.success) {
      return respondError(res, "VALIDATION_ERROR", input.error.message);
    }
    const existing = await getEmailProvider(tenantId);

    // Merge: an omitted OR BLANK secret keeps the stored one (same provider
    // type only — switching SMTP↔Resend always requires the new credential).
    let config: unknown;
    if (input.data.type === "SMTP") {
      const password =
        input.data.password || (existing?.type === "SMTP" ? existing.password : "");
      if (!password) {
        return respondError(res, "VALIDATION_ERROR", "Password SMTP wajib diisi.");
      }
      config = { ...input.data, password };
    } else {
      const apiKey =
        input.data.apiKey || (existing?.type === "RESEND" ? existing.apiKey : "");
      if (!apiKey) {
        return respondError(res, "VALIDATION_ERROR", "API key Resend wajib diisi.");
      }
      config = { ...input.data, apiKey };
    }

    // Re-validate the merged value against the stored schema — one shape,
    // persisted exactly as every reader expects it.
    const stored = emailProviderSchema.safeParse(config);
    if (!stored.success) {
      return respondError(res, "VALIDATION_ERROR", stored.error.message);
    }
    await saveEmailProvider(tenantId, stored.data);
    await logHuman({
      tenantId,
      action: "email.provider_update",
      entityType: "Tenant",
      entityId: tenantId,
      beforeValue: existing ? maskEmailProvider(existing) : { configured: false },
      afterValue: maskEmailProvider(stored.data),
    });
    return res.status(200).json(apiOk(maskEmailProvider(stored.data)));
  }

  if (req.method === "DELETE") {
    const before = await getEmailProvider(tenantId);
    if (before) {
      await clearEmailProvider(tenantId);
      await logHuman({
        tenantId,
        action: "email.provider_disconnect",
        entityType: "Tenant",
        entityId: tenantId,
        beforeValue: maskEmailProvider(before),
        afterValue: { configured: false },
      });
    }
    return res.status(200).json(apiOk({ configured: false }));
  }

  return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
}
