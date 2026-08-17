import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { ToolDefinition, ToolResult } from "@/types/tools";

// product.* tools. All reads are allowed by default; product.update is a write
// (denied + approval by default). Every query filters by tenantId — the agent
// never supplies tenantId, it comes from ToolContext (prompt-injection defense).

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  price: Prisma.Decimal;
};

type SerializedProduct = {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  price: string;
};

function serializeProduct(p: ProductRow): SerializedProduct {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    sku: p.sku,
    price: p.price.toString(),
  };
}

const productReadSchema = z
  .object({
    productId: z.string().uuid().optional(),
    name: z.string().min(1).optional(),
  })
  .refine((v) => v.productId || v.name, {
    message: "productId or name is required",
  });
type ProductReadParams = z.infer<typeof productReadSchema>;

const productRead: ToolDefinition<ProductReadParams> = {
  name: "product.read",
  description: "Get a product by its ID or exact name.",
  category: "product",
  parameters: productReadSchema,
  defaultPermission: { allowed: true, requiresApproval: false },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    const product = await ctx.prisma.product.findFirst({
      where: { tenantId: ctx.tenantId, id: p.productId, name: p.name },
    });
    if (!product) {
      return { success: false, error: "Product not found", errorCode: "NOT_FOUND" };
    }
    await ctx.audit({
      action: "product.read",
      entityType: "product",
      entityId: product.id,
    });
    return { success: true, data: serializeProduct(product) };
  },
};

const productSearchSchema = z.object({
  query: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
type ProductSearchParams = z.infer<typeof productSearchSchema>;

const productSearch: ToolDefinition<ProductSearchParams> = {
  name: "product.search",
  description: "Search products by name (case-insensitive substring).",
  category: "product",
  parameters: productSearchSchema,
  defaultPermission: { allowed: true, requiresApproval: false },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    const products = await ctx.prisma.product.findMany({
      where: {
        tenantId: ctx.tenantId,
        name: p.query
          ? { contains: p.query, mode: "insensitive" }
          : undefined,
      },
      take: p.limit ?? 20,
      orderBy: { name: "asc" },
    });
    await ctx.audit({
      action: "product.search",
      entityType: "product",
      entityId: p.query ?? "",
    });
    return { success: true, data: products.map(serializeProduct) };
  },
};

const productUpdateSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  sku: z.string().optional(),
  // Decimal as string to preserve precision (Prisma accepts string for Decimal).
  price: z.string().optional(),
});
type ProductUpdateParams = z.infer<typeof productUpdateSchema>;

const productUpdate: ToolDefinition<ProductUpdateParams> = {
  name: "product.update",
  description: "Update a product's name, description, sku, or price.",
  category: "product",
  parameters: productUpdateSchema,
  defaultPermission: { allowed: false, requiresApproval: true },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    const before = await ctx.prisma.product.findFirst({
      where: { tenantId: ctx.tenantId, id: p.productId },
    });
    if (!before) {
      return { success: false, error: "Product not found", errorCode: "NOT_FOUND" };
    }

    const data: Prisma.ProductUpdateInput = {};
    if (p.name !== undefined) data.name = p.name;
    if (p.description !== undefined) data.description = p.description;
    if (p.sku !== undefined) data.sku = p.sku;
    if (p.price !== undefined) data.price = p.price;

    const after = await ctx.prisma.product.update({
      where: { id: p.productId },
      data,
    });
    await ctx.audit({
      action: "product.update",
      entityType: "product",
      entityId: after.id,
      beforeValue: serializeProduct(before),
      afterValue: serializeProduct(after),
    });
    return { success: true, data: serializeProduct(after) };
  },
  // Snapshot current + projected state for the approval queue (without executing).
  async describeChange(params, { tenantId, prisma }): Promise<{
    proposedBefore: Prisma.InputJsonValue;
    proposedAfter: Prisma.InputJsonValue;
  }> {
    const before = await prisma.product.findFirst({
      where: { tenantId, id: params.productId },
    });
    const proposedBefore: Prisma.InputJsonValue = before
      ? serializeProduct(before)
      : {};
    const proposedAfter: Prisma.InputJsonValue = {
      id: params.productId,
      name: params.name ?? before?.name ?? "",
      description: params.description ?? before?.description ?? null,
      sku: params.sku ?? before?.sku ?? null,
      price: params.price ?? before?.price.toString() ?? "",
    };
    return { proposedBefore, proposedAfter };
  },
};

export const productTools: ToolDefinition<any>[] = [
  productRead,
  productSearch,
  productUpdate,
];
