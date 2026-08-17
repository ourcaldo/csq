import { z } from "zod";

export const inventoryUpdateSchema = z.object({
  quantity: z.number().int().min(0),
  source: z.enum(["MANUAL", "EXCEL", "GOOGLE_SHEETS"]).optional(),
  sourceRef: z.string().max(300).optional(),
});
export type InventoryUpdateInput = z.infer<typeof inventoryUpdateSchema>;
