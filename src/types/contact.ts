import { z } from "zod";

export const contactUpdateSchema = z.object({
  name: z.string().max(200).nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type ContactUpdateInput = z.infer<typeof contactUpdateSchema>;
