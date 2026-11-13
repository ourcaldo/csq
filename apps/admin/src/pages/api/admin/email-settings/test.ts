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
    return res.status(405).json(apiError("METHOD_NOT_ALLOWED", "Method not allowed."));
  }
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const parsed = testSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json(apiError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid email address."));
  }

  return withSystemContext(async () => {
    const provider = await getPlatformEmailProvider();
    if (!provider) {
      return res
        .status(400)
        .json(apiError("VALIDATION_ERROR", "The platform SMTP is not saved yet - save the configuration first."));
    }
    try {
      const info = await sendEmailWithProvider(provider, {
        to: parsed.data.to,
        subject: "CSQ - platform SMTP test",
        text:
          "This is a test email from CSQ via the platform SMTP. If you received this, " +
          "the platform SMTP configuration is correct and ready as the fallback for all tenants.",
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
      const message = err instanceof Error ? err.message : "Failed to send the test email.";
      return res.status(400).json(apiError("VALIDATION_ERROR", `Test email failed: ${message}`));
    }
  });
}
