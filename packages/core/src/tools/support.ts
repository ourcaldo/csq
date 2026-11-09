import { z } from "zod";
import type { ToolDefinition, ToolResult } from "@csq/core/types/tools";

// support.* tools. FEA-3 (PRD 16): support.create_ticket records a customer
// issue that needs a human beyond the conversation itself (PRD 03 section 17).
// The ticket is an internal record - that is its purpose - so it is allowed by
// default without approval: gating the record on approval would only block the
// customer's escalation from being noted. Routing context (conversationId,
// contactPhone) comes from the server-resolved ToolContext, never from the
// agent - the ticket is always tied to the conversation it came from.

const supportCreateTicketSchema = z.object({
  subject: z.string().min(1).max(120),
  body: z.string().min(1).max(2000),
});
type SupportCreateTicketParams = z.infer<typeof supportCreateTicketSchema>;

const supportCreateTicket: ToolDefinition<SupportCreateTicketParams> = {
  name: "support.create_ticket",
  description:
    "Create an internal support ticket for a customer issue that needs human follow-up beyond this conversation. Staff sees it in the dashboard. The customer is told the issue is recorded.",
  category: "support",
  parameters: supportCreateTicketSchema,
  defaultPermission: { allowed: true, requiresApproval: false },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    const ticket = await ctx.prisma.supportTicket.create({
      data: {
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId ?? null,
        contactPhone: ctx.customerPhone ?? null,
        subject: p.subject,
        body: p.body,
        createdByAgentId: ctx.agentId,
      },
    });
    await ctx.audit({
      action: "support.create_ticket",
      entityType: "SupportTicket",
      entityId: ticket.id,
      afterValue: {
        id: ticket.id,
        conversationId: ticket.conversationId,
        contactPhone: ticket.contactPhone,
        subject: ticket.subject,
        status: ticket.status,
      },
      customerPhone: ctx.customerPhone,
    });
    return { success: true, data: { ticketId: ticket.id, status: ticket.status } };
  },
};

export const supportTools: ToolDefinition<any>[] = [supportCreateTicket];
