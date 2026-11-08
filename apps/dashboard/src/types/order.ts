import { z } from "zod";

export const orderItemCreateSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1),
});
export type OrderItemCreateInput = z.infer<typeof orderItemCreateSchema>;

export const orderCreateSchema = z.object({
  customerName: z.string().max(200).optional(),
  customerPhone: z.string().max(50).optional(),
  items: z.array(orderItemCreateSchema).min(1),
});
export type OrderCreateInput = z.infer<typeof orderCreateSchema>;

export const orderStatusUpdateSchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "CANCELLED"]),
});
export type OrderStatusUpdateInput = z.infer<typeof orderStatusUpdateSchema>;
