import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { ToolDefinition, ToolResult } from "@/types/tools";

// customer.* tools. customer.read allowed by default. customer.update is a
// write (denied + approval by default) and upserts the Contact — capturing a
// new customer or updating an existing one. Lookup is always tenant + phone.

type SerializedContact = {
  id: string;
  phone: string;
  name: string | null;
  notes: string | null;
};

function serializeContact(c: {
  id: string;
  phone: string;
  name: string | null;
  notes: string | null;
}): SerializedContact {
  return { id: c.id, phone: c.phone, name: c.name, notes: c.notes };
}

const customerReadSchema = z.object({
  phone: z.string().min(1),
});
type CustomerReadParams = z.infer<typeof customerReadSchema>;

const customerRead: ToolDefinition<CustomerReadParams> = {
  name: "customer.read",
  description: "Look up a customer by phone number.",
  category: "customer",
  parameters: customerReadSchema,
  defaultPermission: { allowed: true, requiresApproval: false },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    const contact = await ctx.prisma.contact.findFirst({
      where: { tenantId: ctx.tenantId, phone: p.phone },
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
  phone: z.string().min(1),
  name: z.string().min(1).optional(),
  notes: z.string().optional(),
});
type CustomerUpdateParams = z.infer<typeof customerUpdateSchema>;

const customerUpdate: ToolDefinition<CustomerUpdateParams> = {
  name: "customer.update",
  description: "Create or update a customer's name/notes by phone number.",
  category: "customer",
  parameters: customerUpdateSchema,
  defaultPermission: { allowed: false, requiresApproval: true },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    const before = await ctx.prisma.contact.findFirst({
      where: { tenantId: ctx.tenantId, phone: p.phone },
    });

    // Upsert keyed on the tenant+phone unique constraint. `update` passes
    // undefined for omitted fields (Prisma treats that as a no-op, preserving
    // existing name/notes). `create` supplies defaults for a new customer.
    const after = await ctx.prisma.contact.upsert({
      where: { tenantId_phone: { tenantId: ctx.tenantId, phone: p.phone } },
      create: {
        tenantId: ctx.tenantId,
        phone: p.phone,
        name: p.name ?? null,
        notes: p.notes ?? null,
      },
      update: { name: p.name, notes: p.notes },
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
    const before = await prisma.contact.findFirst({
      where: { tenantId, phone: params.phone },
    });
    const proposedBefore: Prisma.InputJsonValue = before
      ? serializeContact(before)
      : {};
    const proposedAfter: Prisma.InputJsonValue = {
      phone: params.phone,
      name: params.name ?? before?.name ?? null,
      notes: params.notes ?? before?.notes ?? null,
    };
    return { proposedBefore, proposedAfter };
  },
};

export const customerTools: ToolDefinition<any>[] = [
  customerRead,
  customerUpdate,
];
