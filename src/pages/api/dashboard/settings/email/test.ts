import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthSession, requireRole } from "@/lib/auth";
import { logHuman } from "@/lib/audit";
import { requireTenant, respondError } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";
import { getEmailProvider, maskEmailProvider } from "@/lib/email-config";
import { sendEmailWithProvider } from "@/services/email";

// Test-send for Settings → Email: sends one plain-text email through the
// SAVED provider config to the owner's own address, so the owner can confirm
// their SMTP/Resend setup works before wiring scenario Email nodes. OWNER-only
// (same boundary as the config route). Never echoes the credential back.

type TestResponse = { sent: true; to: string; messageId: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<TestResponse>>
) {
  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(
      res,
      "PERMISSION_DENIED",
      "Hanya owner yang dapat menguji integrasi email."
    );
  }
  const tenantId = requireTenant(session);

  const provider = await getEmailProvider(tenantId);
  if (!provider) {
    return respondError(
      res,
      "VALIDATION_ERROR",
      "Email belum diatur — simpan konfigurasi SMTP/Resend terlebih dahulu."
    );
  }

  const to = session.user.email;
  try {
    const info = await sendEmailWithProvider(provider, {
      to,
      subject: "CSQ — tes integrasi email",
      text:
        "Ini adalah email percobaan dari CSQ. Jika Anda menerima ini, integrasi email usaha Anda sudah siap dipakai modul Email pada Skenario.",
    });
    await logHuman({
      tenantId,
      action: "email.provider_test",
      entityType: "Tenant",
      entityId: tenantId,
      afterValue: { ...maskEmailProvider(provider), to, messageId: info.messageId },
    });
    return res.status(200).json(apiOk({ sent: true, to, messageId: info.messageId }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal mengirim email tes.";
    return respondError(res, "VALIDATION_ERROR", `Email tes gagal terkirim: ${message}`);
  }
}
