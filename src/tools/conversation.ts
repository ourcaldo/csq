import { z } from "zod";
import type { ToolDefinition, ToolResult } from "@/types/tools";

// conversation.* tools. conversation.handoff transfers the current conversation
// from the AI to a human (FR-AS-003 / FR-HD-001): it sets `assigneeUserId` to
// the tenant's owner and clears `assignedAgentId`, which makes runAgentReply
// stand the AI down on the next inbound. The agent calls this when the customer
// asks to speak with a human / live agent / staff.
//
// Allowed by default without approval: the customer explicitly requested a
// human, so gating the transfer on owner approval would defeat the purpose (the
// owner would have to approve the very handoff they're being asked to handle).
// The owner can hand back to the AI anytime from the inbox (clears
// assigneeUserId), which re-enables auto-reply.
//
// Routing context (conversationId, tenantId, customerPhone) is server-resolved
// from ToolContext, never agent-supplied — the agent cannot hand off a
// conversation other than the one it's in.

const handoffSchema = z.object({
  // Optional free-text reason the agent is escalating (e.g. "customer requested
  // human"). Audited for context; not validated beyond being a string.
  reason: z.string().max(500).optional(),
});
type HandoffParams = z.infer<typeof handoffSchema>;

const conversationHandoff: ToolDefinition<HandoffParams> = {
  name: "conversation.handoff",
  description:
    "Transfer the current conversation to a human agent. Call this when the customer asks to speak with a human, live agent, or staff. The AI will stop auto-replying until a human hands the conversation back.",
  category: "conversation",
  parameters: handoffSchema,
  defaultPermission: { allowed: true, requiresApproval: false },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    const conversationId = ctx.conversationId;
    if (!conversationId) {
      return {
        success: false,
        error: "No active conversation to hand off",
        errorCode: "VALIDATION_ERROR",
      };
    }

    // Resolve the tenant's owner to assign the conversation to. MVP is
    // single-owner; if multiple OWNER rows exist, the first (by createdAt) is
    // assigned. Round-robin across staff is a later enhancement.
    const owner = await ctx.prisma.user.findFirst({
      where: { tenantId: ctx.tenantId, role: "OWNER" },
      orderBy: { createdAt: "asc" },
    });
    if (!owner) {
      return {
        success: false,
        error: "No owner available to hand off to",
        errorCode: "NOT_FOUND",
      };
    }

    // Verify the conversation exists and is tenant-owned before mutating.
    const existing = await ctx.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId: ctx.tenantId },
    });
    if (!existing) {
      return {
        success: false,
        error: "Conversation not found",
        errorCode: "NOT_FOUND",
      };
    }

    // Assign to the human owner and clear the AI agent assignment. This mirrors
    // assignConversation's XOR invariant (userId set ⇒ agentId cleared) which
    // is what stands the AI down in runAgentReply. G9: tenant-gate the mutation
    // via updateMany + count assert (defense-in-depth alongside the preceding
    // tenant-scoped findFirst), then re-read for the audit diff.
    const updateResult = await ctx.prisma.conversation.updateMany({
      where: { id: conversationId, tenantId: ctx.tenantId },
      data: {
        assigneeUserId: owner.id,
        assignedAgentId: null,
      },
    });
    if (updateResult.count !== 1) {
      return {
        success: false,
        error: "Conversation not found",
        errorCode: "NOT_FOUND",
      };
    }
    const after = await ctx.prisma.conversation.findFirstOrThrow({
      where: { id: conversationId, tenantId: ctx.tenantId },
      select: {
        id: true,
        assignedAgentId: true,
        assigneeUserId: true,
      },
    });

    await ctx.audit({
      action: "conversation.handoff",
      entityType: "Conversation",
      entityId: conversationId,
      beforeValue: {
        assignedAgentId: existing.assignedAgentId,
        assigneeUserId: existing.assigneeUserId,
      },
      afterValue: {
        assignedAgentId: after.assignedAgentId,
        assigneeUserId: after.assigneeUserId,
        reason: p.reason ?? null,
      },
      customerPhone: ctx.customerPhone,
    });

    return {
      success: true,
      data: {
        handedOff: true,
        assigneeUserId: after.assigneeUserId,
        message: "Conversation transferred to a human agent.",
      },
    };
  },
  // No meaningful before/after diff beyond what the handler already records;
  // handoff is non-destructive (reversible by the owner). describeChange is
  // omitted because the tool is allowed without approval, so the approval
  // snapshot path in executeTool never runs.
};

export const conversationTools: ToolDefinition<any>[] = [conversationHandoff];
