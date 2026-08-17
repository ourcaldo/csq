import { z } from "zod";
import { moneySchema } from "@/types/money";

export const productCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  sku: z.string().max(100).optional(),
  price: moneySchema,
});
export type ProductCreateInput = z.infer<typeof productCreateSchema>;

export const productUpdateSchema = productCreateSchema.partial();
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
