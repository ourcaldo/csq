import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { ToolDefinition, ToolResult } from "@/types/tools";
import { resolveInventory } from "@/lib/source-priority";

// inventory.* tools. inventory.read is allowed by default; inventory.update is
// a write (denied + approval by default). Stock is set absolutely (not a delta)
// to match the SDD approval-diff example ({ quantity: 12 } → { quantity: 10 }).

type SerializedInventory = {
  productId: string;
  quantity: number;
  source: string;
  sourceRef: string | null;
};

function serializeInventory(inv: {
  productId: string;
  quantity: number;
  source: string;
  sourceRef: string | null;
}): SerializedInventory {
  return {
    productId: inv.productId,
    quantity: inv.quantity,
    source: inv.source,
    sourceRef: inv.sourceRef,
  };
}

const inventoryReadSchema = z.object({
  productId: z.string().uuid(),
});
type InventoryReadParams = z.infer<typeof inventoryReadSchema>;

const inventoryRead: ToolDefinition<InventoryReadParams> = {
  name: "inventory.read",
  description: "Get the current stock quantity for a product.",
  category: "inventory",
  parameters: inventoryReadSchema,
  defaultPermission: { allowed: true, requiresApproval: false },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    // G8: resolve the authoritative quantity by Tenant.settings.sourcePriority
    // across per-source snapshots, falling back to the canonical Inventory row.
    const resolved = await resolveInventory(ctx.tenantId, p.productId);
    if (!resolved) {
      return { success: false, error: "Inventory not found", errorCode: "NOT_FOUND" };
    }
    await ctx.audit({
      action: "inventory.read",
      entityType: "inventory",
      entityId: p.productId,
    });
    return {
      success: true,
      data: {
        productId: p.productId,
        quantity: resolved.quantity,
        source: resolved.source,
        sourceRef: resolved.sourceRef,
      },
    };
  },
};

const inventoryUpdateSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(0),
});
type InventoryUpdateParams = z.infer<typeof inventoryUpdateSchema>;

const inventoryUpdate: ToolDefinition<InventoryUpdateParams> = {
  name: "inventory.update",
  description: "Set the stock quantity for a product (absolute value).",
  category: "inventory",
  parameters: inventoryUpdateSchema,
  defaultPermission: { allowed: false, requiresApproval: true },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    const before = await ctx.prisma.inventory.findFirst({
      where: { tenantId: ctx.tenantId, productId: p.productId },
    });
    if (!before) {
      return { success: false, error: "Inventory not found", errorCode: "NOT_FOUND" };
    }

    // G8: record the manual write as a MANUAL snapshot so the resolution
    // layer sees it alongside imports, then update the canonical row.
    await ctx.prisma.inventorySnapshot.upsert({
      where: { tenantId_productId_source: { tenantId: ctx.tenantId, productId: p.productId, source: "MANUAL" } },
      create: {
        tenantId: ctx.tenantId,
        productId: p.productId,
        source: "MANUAL",
        quantity: p.quantity,
        syncedAt: new Date(),
      },
      update: { quantity: p.quantity, syncedAt: new Date() },
    });

    const after = await ctx.prisma.inventory.update({
      where: { tenantId_productId: { tenantId: ctx.tenantId, productId: p.productId } },
      data: { quantity: p.quantity, source: "MANUAL", sourceRef: null },
    });
    await ctx.audit({
      action: "inventory.update",
      entityType: "inventory",
      entityId: after.productId,
      beforeValue: serializeInventory(before),
      afterValue: serializeInventory(after),
    });
    return { success: true, data: serializeInventory(after) };
  },
  async describeChange(params, { tenantId, prisma }): Promise<{
    proposedBefore: Prisma.InputJsonValue;
    proposedAfter: Prisma.InputJsonValue;
  }> {
    const before = await prisma.inventory.findFirst({
      where: { tenantId, productId: params.productId },
    });
    const proposedBefore: Prisma.InputJsonValue = before
      ? serializeInventory(before)
      : {};
    const proposedAfter: Prisma.InputJsonValue = {
      productId: params.productId,
      quantity: params.quantity,
      source: before?.source ?? "MANUAL",
      sourceRef: before?.sourceRef ?? null,
    };
    return { proposedBefore, proposedAfter };
  },
};

export const inventoryTools: ToolDefinition<any>[] = [
  inventoryRead,
  inventoryUpdate,
];
