import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { requireTenant, respondError, strQuery } from "@/lib/queries";
import { runAgentReply, type AgentTurnResult } from "@/lib/agent-loop";
import { apiOk, type ApiResponse } from "@/types/api";

// Documented agent turn endpoint (plan 6.4). Runs one customer-service agent
// turn for a conversation and returns the reply + tool-call log. Authenticated
// via the dashboard session and tenant-scoped — the WhatsApp webhook path uses
// runAgentReply directly (fire-and-forget); this route exposes the same engine
// for dashboard "test agent" / manual triggering without WhatsApp side effects.

const chatSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().min(1).max(4096),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse<AgentTurnResult>>
) {
  if (req.method !== "POST") {
    return respondError(res, "VALIDATION_ERROR", "Metode tidak didukung.");
  }

  const session = await getAuthSession(req, res);
  if (!session) return respondError(res, "UNAUTHORIZED", "Masuk diperlukan.");
  const tenantId = requireTenant(session);

  const agentId = strQuery(req.query, "agentId");
  if (!agentId) return respondError(res, "VALIDATION_ERROR", "ID agent tidak valid.");

  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    return respondError(res, "VALIDATION_ERROR", parsed.error.message);
  }

  // Ensure the agent belongs to this tenant.
  const agent = await prisma.agent.findFirst({ where: { id: agentId, tenantId } });
  if (!agent) return respondError(res, "NOT_FOUND", "Agent tidak ditemukan.");

  // Ensure the conversation belongs to this tenant (and optionally this agent).
  const conversation = await prisma.conversation.findFirst({
    where: { id: parsed.data.conversationId, tenantId },
  });
  if (!conversation) {
    return respondError(res, "NOT_FOUND", "Percakapan tidak ditemukan.");
  }

  // M4: serialize against the webhook path. runAgentReply executes tool side
  // effects (stock/order mutations) and must not run concurrently with a
  // customer inbound on the same conversation. The webhook path
  // (agent-loop.ts) wraps its turn in `pg_advisory_xact_lock(hashtext(
  // conversationId)::bigint)`; we acquire the SAME lock key here so the two
  // paths serialize against each other. Without this, a dashboard test turn
  // racing a customer inbound could produce duplicate tool side effects.
  const turn = await prisma.$transaction(
    async () => {
      await prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${conversation.id})::bigint)`;
      return runAgentReply({
        tenantId,
        conversationId: conversation.id,
        customerPhone: conversation.customerPhone,
        body: parsed.data.body,
      });
    },
    { timeout: 120_000, maxWait: 10_000 }
  );

  return res.status(200).json(apiOk(turn));
}
