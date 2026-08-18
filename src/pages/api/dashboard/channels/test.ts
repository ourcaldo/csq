import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession, requireRole } from "@/lib/auth";
import prisma from "@/lib/db";
import { getProvider } from "@/lib/whatsapp-provider";
import { requireTenant, respondError, strQuery } from "@/lib/queries";
import { apiOk, type ApiResponse } from "@/types/api";

// Test a channel by sending a small text to a given number via the channel's
// provider. OWNER-only, tenant-scoped (plan 7.5). Useful to confirm Cloud API
// creds or a Baileys session works end-to-end.
const testSchema = z.object({
  to: z.string().min(5).max(32),
});

export type TestResult = { ok: boolean; waMessageId?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<TestResult>>
) {
  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  if (!requireRole(session, "OWNER")) {
    return respondError(res, "PERMISSION_DENIED", "Hanya owner yang dapat mengetes channel.");
  }
  const tenantId = requireTenant(session);

  const id = strQuery(req.query, "id");
  if (!id) return respondError(res, "VALIDATION_ERROR", "ID channel tidak valid.");

  const parsed = testSchema.safeParse(req.body);
  if (!parsed.success) {
    return respondError(res, "VALIDATION_ERROR", parsed.error.message);
  }

  const channel = await prisma.channel.findFirst({ where: { id, tenantId } });
  if (!channel) return respondError(res, "NOT_FOUND", "Channel tidak ditemukan.");
  if (channel.status !== "CONNECTED") {
    return respondError(res, "VALIDATION_ERROR", "Channel belum terhubung.");
  }

  try {
    const provider = getProvider(channel);
    const result = await provider.sendText({
      to: parsed.data.to,
      body: "Test dari CSQ dashboard ✅ — channel aktif.",
    });
    return res.status(200).json(apiOk({ ok: true, waMessageId: result.waMessageId }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal mengirim test.";
    return respondError(res, "INTERNAL_ERROR", message);
  }
}
