import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { ToolDefinition, ToolResult } from "@/types/tools";

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
        const have = pr.inventory?.quantity ?? 0;
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

      // Decrement stock for each validated item.
      for (const adj of stockAdjust) {
        await tx.inventory.update({
          where: { productId: adj.productId },
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

      const cancelled = await tx.order.update({
        where: { id: order.id },
        data: { status: "CANCELLED" },
        include: { items: { include: { product: true } } },
      });

      // Restore stock for each line item.
      for (const item of order.items) {
        const inv = await tx.inventory.findFirst({
          where: { tenantId: ctx.tenantId, productId: item.productId },
        });
        const current = inv?.quantity ?? 0;
        if (inv) {
          await tx.inventory.update({
            where: { productId: item.productId },
            data: { quantity: current + item.quantity },
          });
        }
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
