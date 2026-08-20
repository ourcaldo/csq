import { z } from "zod";

export const contactUpdateSchema = z.object({
  name: z.string().max(200).optional(),
  email: z.string().email().max(200).optional(),
  notes: z.string().max(2000).optional(),
});
export type ContactUpdateInput = z.infer<typeof contactUpdateSchema>;
