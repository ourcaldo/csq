import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { ToolDefinition, ToolResult } from "@/types/tools";
import { events } from "@/lib/events";

// order.* tools. order.read allowed by default. order.create is a write
// (denied + approval by default): creates an Order + OrderItems and decrements
// Inventory in one transaction, validating stock first. order.cancel is a write
// with approval required; cancelling restores the decremented stock.

type SerializedOrderItem = {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  subtotal: string;
};

type SerializedOrder = {
  id: string;
  customerName: string | null;
  customerPhone: string | null;
  status: string;
  totalAmount: string;
  items: SerializedOrderItem[];
};

function serializeOrder(
  order: {
    id: string;
    customerName: string | null;
    customerPhone: string | null;
    status: string;
    totalAmount: Prisma.Decimal;
    items: {
      productId: string;
      quantity: number;
      unitPrice: Prisma.Decimal;
      subtotal: Prisma.Decimal;
      product: { name: string };
    }[];
  }
): SerializedOrder {
  return {
    id: order.id,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    status: order.status,
    totalAmount: order.totalAmount.toString(),
    items: order.items.map((it) => ({
      productId: it.productId,
      productName: it.product.name,
      quantity: it.quantity,
      unitPrice: it.unitPrice.toString(),
      subtotal: it.subtotal.toString(),
    })),
  };
}

const orderReadSchema = z.object({
  orderId: z.string().uuid(),
});
type OrderReadParams = z.infer<typeof orderReadSchema>;

const orderRead: ToolDefinition<OrderReadParams> = {
  name: "order.read",
  description: "Get an order with its line items.",
  category: "order",
  parameters: orderReadSchema,
  defaultPermission: { allowed: true, requiresApproval: false },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    const order = await ctx.prisma.order.findFirst({
      where: { tenantId: ctx.tenantId, id: p.orderId },
      include: { items: { include: { product: true } } },
    });
    if (!order) {
      return { success: false, error: "Order not found", errorCode: "NOT_FOUND" };
    }
    await ctx.audit({
      action: "order.read",
      entityType: "order",
      entityId: order.id,
      customerPhone: order.customerPhone ?? undefined,
    });
    return { success: true, data: serializeOrder(order) };
  },
};

const orderCreateSchema = z.object({
  customerName: z.string().min(1).optional(),
  customerPhone: z.string().min(1).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1),
      })
    )
    .min(1),
});
type OrderCreateParams = z.infer<typeof orderCreateSchema>;

const orderCreate: ToolDefinition<OrderCreateParams> = {
  name: "order.create",
  description:
    "Create an order from line items and decrement stock. Validates stock first.",
  category: "order",
  parameters: orderCreateSchema,
  defaultPermission: { allowed: false, requiresApproval: true },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    const productIds = p.items.map((it) => it.productId);

    // One transaction: validate stock + compute totals + create order + decrement.
    const order = await ctx.prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { tenantId: ctx.tenantId, id: { in: productIds } },
        include: { inventory: true },
      });
      const byId = new Map(products.map((pr) => [pr.id, pr]));

      // G2: lock the inventory rows FOR UPDATE so a concurrent order.create or
      // stock write cannot both pass the stock check against a stale snapshot
      // and oversell. Prisma has no FOR UPDATE API, so raw SQL through the
      // transaction client. Row-level locking is defense-in-depth on top of
      // the per-conversation advisory lock in the agent loop.
      const locked = await tx.$queryRaw<
        Array<{ productId: string; quantity: number }>
      >`SELECT "productId", quantity FROM "Inventory"
        WHERE "tenantId" = ${ctx.tenantId} AND "productId" IN (${Prisma.join(productIds)})
        FOR UPDATE`;
      const lockedById = new Map(locked.map((r) => [r.productId, r.quantity]));

      // Single pass: validate each item, build order items, compute total, and
      // stage the stock adjustments. The throw narrows `pr` for TS.
      let total = 0;
      const orderItems: Prisma.OrderItemCreateManyOrderInput[] = [];
      const stockAdjust: { productId: string; newQuantity: number }[] = [];

      for (const item of p.items) {
        const pr = byId.get(item.productId);
        if (!pr) {
          throw new Error(`Product not found: ${item.productId}`);
        }
        const have = lockedById.get(item.productId) ?? 0;
        if (have < item.quantity) {
          throw new Error(`Insufficient stock for ${pr.name} (have ${have})`);
        }
        const unitPrice = pr.price;
        const subtotal = unitPrice.mul(item.quantity);
        total += subtotal.toNumber();
        orderItems.push({
          tenantId: ctx.tenantId,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice,
          subtotal,
        });
        stockAdjust.push({
          productId: item.productId,
          newQuantity: have - item.quantity,
        });
      }

      const created = await tx.order.create({
        data: {
          tenantId: ctx.tenantId,
          customerName: p.customerName,
          customerPhone: p.customerPhone,
          totalAmount: total,
          createdByAgentId: ctx.agentId,
          status: "CONFIRMED",
          items: { createMany: { data: orderItems } },
        },
        include: { items: { include: { product: true } } },
      });

      // Decrement stock for each validated item. G9: tenant-gated compound
      // unique selector (not the global productId @unique).
      for (const adj of stockAdjust) {
        await tx.inventory.update({
          where: { tenantId_productId: { tenantId: ctx.tenantId, productId: adj.productId } },
          data: { quantity: adj.newQuantity },
        });
      }

      return created;
    });

    await ctx.audit({
      action: "order.create",
      entityType: "order",
      entityId: order.id,
      afterValue: serializeOrder(order),
      customerPhone: order.customerPhone ?? undefined,
    });

    // Emit `order.purchased` so active ON_PURCHASE scenarios can start a run
    // (after-sales survey, etc.). Fire-and-forget; routing context (conversation
    // + phone) flows from the tool call so the scenario can resolve the
    // customer thread. No-op if no scenario is subscribed/listening.
    events.emit("order.purchased", {
      tenantId: ctx.tenantId,
      orderId: order.id,
      conversationId: ctx.conversationId,
      customerPhone: order.customerPhone ?? ctx.customerPhone ?? undefined,
      customerName: order.customerName ?? undefined,
      orderTotal: order.totalAmount.toString(),
      orderItems: order.items.map((it) => ({
        productName: it.product.name,
        quantity: it.quantity,
      })),
    });

    return { success: true, data: serializeOrder(order) };
  },
  async describeChange(params): Promise<{
    proposedBefore: Prisma.InputJsonValue;
    proposedAfter: Prisma.InputJsonValue;
  }> {
    // No single "before" entity — the proposed result is the order summary.
    return {
      proposedBefore: {},
      proposedAfter: {
        customerName: params.customerName ?? null,
        customerPhone: params.customerPhone ?? null,
        items: params.items,
        status: "CONFIRMED",
      },
    };
  },
};

const orderCancelSchema = z.object({
  orderId: z.string().uuid(),
});
type OrderCancelParams = z.infer<typeof orderCancelSchema>;

const orderCancel: ToolDefinition<OrderCancelParams> = {
  name: "order.cancel",
  description: "Cancel an order and restore its stock. Requires owner approval.",
  category: "order",
  parameters: orderCancelSchema,
  defaultPermission: { allowed: false, requiresApproval: true },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    const result = await ctx.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { tenantId: ctx.tenantId, id: p.orderId },
        include: { items: true },
      });
      if (!order) {
        throw new Error("Order not found");
      }
      if (order.status === "CANCELLED") {
        throw new Error("Order already cancelled");
      }

      // G9: tenant-gate the status mutation via updateMany + count assert (Order
      // has no compound unique on id, only the PK), then re-read with include.
      const updateResult = await tx.order.updateMany({
        where: { id: order.id, tenantId: ctx.tenantId },
        data: { status: "CANCELLED" },
      });
      if (updateResult.count !== 1) {
        throw new Error("Order not found or not tenant-owned");
      }
      const cancelled = await tx.order.findFirstOrThrow({
        where: { id: order.id, tenantId: ctx.tenantId },
        include: { items: { include: { product: true } } },
      });

      // G2/G9: lock the inventory rows FOR UPDATE before restoring, and use the
      // tenant-gated compound unique selector on the update. Locking prevents a
      // concurrent order.create from racing the restore.
      const restoreProductIds = order.items.map((it) => it.productId);
      const locked = await tx.$queryRaw<
        Array<{ productId: string; quantity: number }>
      >`SELECT "productId", quantity FROM "Inventory"
        WHERE "tenantId" = ${ctx.tenantId} AND "productId" IN (${Prisma.join(restoreProductIds)})
        FOR UPDATE`;
      const lockedById = new Map(locked.map((r) => [r.productId, r.quantity]));

      for (const item of order.items) {
        const current = lockedById.get(item.productId);
        if (current === undefined) continue;
        await tx.inventory.update({
          where: { tenantId_productId: { tenantId: ctx.tenantId, productId: item.productId } },
          data: { quantity: current + item.quantity },
        });
      }

      return cancelled;
    });

    await ctx.audit({
      action: "order.cancel",
      entityType: "order",
      entityId: result.id,
      afterValue: serializeOrder(result),
      customerPhone: result.customerPhone ?? undefined,
    });
    return { success: true, data: serializeOrder(result) };
  },
  async describeChange(params, { tenantId, prisma }): Promise<{
    proposedBefore: Prisma.InputJsonValue;
    proposedAfter: Prisma.InputJsonValue;
  }> {
    const before = await prisma.order.findFirst({
      where: { tenantId, id: params.orderId },
      include: { items: { include: { product: true } } },
    });
    return {
      proposedBefore: before ? serializeOrder(before) : {},
      proposedAfter: before
        ? { ...serializeOrder(before), status: "CANCELLED" }
        : {},
    };
  },
};

export const orderTools: ToolDefinition<any>[] = [
  orderRead,
  orderCreate,
  orderCancel,
];
