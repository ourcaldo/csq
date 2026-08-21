import { z } from "zod";
import type { ToolDefinition, ToolResult } from "@/types/tools";
import { setConversationStage } from "@/lib/pipeline";
import { HttpError } from "@/lib/queries";

// deal.* tools. deal.setStage lets the CS agent move the current conversation's
// deal to a new stage as the conversation flows (customer asks for price →
// Penawaran; order.create → Pesanan; order confirmed → Menang; customer
// declines → Kalah). Allowed without approval — a CRM state change, not a
// business write; the human can override via the dashboard PATCH. The stage is
// resolved by name within the tenant's pipeline; the valid names are injected
// into the system prompt so the model knows what to pass.

const setStageSchema = z.object({
  stageName: z.string().min(1),
  reason: z.string().max(300).optional(),
});
type SetStageParams = z.infer<typeof setStageSchema>;

const dealSetStage: ToolDefinition<SetStageParams> = {
  name: "deal.setStage",
  description:
    "Pindahkan percakapan ini ke tahap pipeline tertentu (mis. Baru, Tertarik, Penawaran, " +
    "Pesanan, Menang, Kalah). Gunakan saat alur percakapan berubah: pelanggan minta " +
    "harga → Penawaran; pesanan dibuat → Pesanan; pesanan dikonfirmasi/dibayar → Menang; " +
    "pelanggan menolak/hilang → Kalah. `stageName` harus salah satu tahap yang tersedia.",
  category: "deal",
  parameters: setStageSchema,
  defaultPermission: { allowed: true, requiresApproval: false },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    if (!ctx.conversationId) {
      return {
        success: false,
        error: "Tidak ada percakapan aktif untuk diatur tahapnya.",
        errorCode: "VALIDATION_ERROR",
      };
    }
    try {
      const result = await setConversationStage({
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        stageName: p.stageName,
        movedByAgentId: ctx.agentId,
        reason: p.reason,
      });
      return { success: true, data: result };
    } catch (err) {
      // setConversationStage throws HttpError for not-found / terminal moves.
      const message =
        err instanceof HttpError ? err.message : "Gagal mengubah tahap deal.";
      return { success: false, error: message, errorCode: "VALIDATION_ERROR" };
    }
  },
};

export const dealTools: ToolDefinition<any>[] = [dealSetStage];
