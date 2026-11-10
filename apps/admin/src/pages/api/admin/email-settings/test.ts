import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { apiError, apiOk, type ApiResponse } from "@csq/core/types/api";
import { requireAdmin, auditAdminAction } from "@/lib/admin-auth";
import { withSystemContext } from "@csq/core/lib/tenant-context";
import { getPlatformEmailProvider, maskEmailProvider } from "@csq/core/lib/email-config";
import { sendEmailWithProvider } from "@csq/core/services/email";

// Test-send through the SAVED platform SMTP (owner request 2026-11-10): the
// admin supplies the destination address, one plain-text email goes out
// through the exact provider every tenant fallback send would use. Audited
// with the masked provider shape; the credential never leaves the server.

const testSchema = z.object({
  to: z.string().email().min(3).max(320),
});

type TestResponse = { sent: true; to: string; messageId: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<TestResponse>>
) {
  if (req.method !== "POST") {
    return res.status(405).json(apiError("VALIDATION_ERROR", "Metode tidak didukung."));
  }
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const parsed = testSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json(apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Alamat email tidak valid."));
  }

  return withSystemContext(async () => {
    const provider = await getPlatformEmailProvider();
    if (!provider) {
      return res
        .status(400)
        .json(apiError("VALIDATION_ERROR", "SMTP platform belum disimpan - simpan konfigurasi dulu."));
    }
    try {
      const info = await sendEmailWithProvider(provider, {
        to: parsed.data.to,
        subject: "CSQ - tes SMTP platform",
        text:
          "Ini adalah email percobaan dari CSQ lewat SMTP platform. Jika Anda menerima ini, " +
          "konfigurasi SMTP platform sudah benar dan siap dipakai sebagai fallback semua tenant.",
      });
      await auditAdminAction({
        adminId: admin.adminId,
        action: "platform_email.test",
        targetType: "BillingSetting",
        targetId: "singleton",
        afterValue: { ...maskEmailProvider(provider), to: parsed.data.to, messageId: info.messageId },
      });
      return res.status(200).json(apiOk({ sent: true, to: parsed.data.to, messageId: info.messageId }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal mengirim email tes.";
      return res.status(400).json(apiError("VALIDATION_ERROR", `Email tes gagal terkirim: ${message}`));
    }
  });
}
