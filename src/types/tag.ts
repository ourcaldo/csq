import { z } from "zod";

export const tagCreateSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().max(20).optional(),
});
export type TagCreateInput = z.infer<typeof tagCreateSchema>;

export const tagUpdateSchema = tagCreateSchema.partial();
export type TagUpdateInput = z.infer<typeof tagUpdateSchema>;
