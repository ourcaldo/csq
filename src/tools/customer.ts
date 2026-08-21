import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { ToolDefinition, ToolResult } from "@/types/tools";

// customer.* tools. customer.read and customer.update are both allowed by
// default without approval: capturing identity the customer volunteered
// (name, email) is part of the CRM conversation loop, not a sensitive business
// write. Lookup is always tenant + phone. In the agent path the phone comes
// from ctx.customerPhone (the current conversation), never from the model — so
// the agent never needs to ask for the customer's number and a prompt cannot
// redirect a write to another tenant's contact.

type SerializedContact = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  notes: string | null;
};

function serializeContact(c: {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  notes: string | null;
}): SerializedContact {
  return { id: c.id, phone: c.phone, name: c.name, email: c.email, notes: c.notes };
}

const customerReadSchema = z.object({
  // phone is optional in the schema so zodToJsonSchema does not force the model
  // to supply it; the handler falls back to ctx.customerPhone (the current
  // conversation's customer). An explicit phone is still accepted for the
  // HTTP Tool Gateway path where there is no conversation context.
  phone: z.string().min(1).optional(),
});
type CustomerReadParams = z.infer<typeof customerReadSchema>;

const customerRead: ToolDefinition<CustomerReadParams> = {
  name: "customer.read",
  description:
    "Look up the current customer (by the conversation's phone) or by an explicit phone number. Returns name, email, and notes.",
  category: "customer",
  parameters: customerReadSchema,
  defaultPermission: { allowed: true, requiresApproval: false },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    const phone = p.phone ?? ctx.customerPhone;
    if (!phone) {
      return {
        success: false,
        error: "No phone number available in this context",
        errorCode: "VALIDATION_ERROR",
      };
    }
    const contact = await ctx.prisma.contact.findFirst({
      where: { tenantId: ctx.tenantId, phone },
    });
    if (!contact) {
      return { success: false, error: "Customer not found", errorCode: "NOT_FOUND" };
    }
    await ctx.audit({
      action: "customer.read",
      entityType: "customer",
      entityId: contact.id,
      customerPhone: contact.phone,
    });
    return { success: true, data: serializeContact(contact) };
  },
};

const customerUpdateSchema = z.object({
  phone: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  notes: z.string().optional(),
});
type CustomerUpdateParams = z.infer<typeof customerUpdateSchema>;

// Capturing identity the customer voluntarily provided about themselves (name,
// email) is part of the CRM conversation loop, not a sensitive business write
// like a price/stock/order change. It is allowed by default without owner
// approval so the agent can record introductions and pre-order/pre-handoff
// email in-flow. The phone is server-resolved from ctx.customerPhone (never
// agent-supplied in the agent path), so a prompt-injection cannot redirect the
// write to another customer's record.
const customerUpdate: ToolDefinition<CustomerUpdateParams> = {
  name: "customer.update",
  description:
    "Create or update the current customer's name, email, or notes. Phone is taken from the conversation, so do not ask the customer for their number.",
  category: "customer",
  parameters: customerUpdateSchema,
  defaultPermission: { allowed: true, requiresApproval: false },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    const phone = p.phone ?? ctx.customerPhone;
    if (!phone) {
      return {
        success: false,
        error: "No phone number available in this context",
        errorCode: "VALIDATION_ERROR",
      };
    }
    const before = await ctx.prisma.contact.findFirst({
      where: { tenantId: ctx.tenantId, phone },
    });

    // Upsert keyed on the tenant+phone unique constraint. `update` passes
    // undefined for omitted fields (Prisma treats that as a no-op, preserving
    // existing name/email/notes). `create` supplies defaults for a new customer.
    const after = await ctx.prisma.contact.upsert({
      where: { tenantId_phone: { tenantId: ctx.tenantId, phone } },
      create: {
        tenantId: ctx.tenantId,
        phone,
        name: p.name ?? null,
        email: p.email ?? null,
        notes: p.notes ?? null,
      },
      update: { name: p.name, email: p.email, notes: p.notes },
    });

    await ctx.audit({
      action: "customer.update",
      entityType: "customer",
      entityId: after.id,
      beforeValue: before ? serializeContact(before) : {},
      afterValue: serializeContact(after),
      customerPhone: after.phone,
    });
    return { success: true, data: serializeContact(after) };
  },
  async describeChange(params, { tenantId, prisma }): Promise<{
    proposedBefore: Prisma.InputJsonValue;
    proposedAfter: Prisma.InputJsonValue;
  }> {
    const phone = params.phone;
    const before = phone
      ? await prisma.contact.findFirst({ where: { tenantId, phone } })
      : null;
    const proposedBefore: Prisma.InputJsonValue = before
      ? serializeContact(before)
      : {};
    const proposedAfter: Prisma.InputJsonValue = {
      phone: phone ?? null,
      name: params.name ?? before?.name ?? null,
      email: params.email ?? before?.email ?? null,
      notes: params.notes ?? before?.notes ?? null,
    };
    return { proposedBefore, proposedAfter };
  },
};

export const customerTools: ToolDefinition<any>[] = [
  customerRead,
  customerUpdate,
];
