import { z } from "zod";

// A hex color is optional and may be left empty (the API will then auto-assign
// a random one). When provided it must be a valid 3- or 6-digit hex, with or
// without the leading `#`.
const colorField = z
  .string()
  .max(20)
  .regex(
    /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})?$/,
    "Format warna tidak valid (contoh: #ef4444 atau #fff)"
  )
  .optional();

export const tagCreateSchema = z.object({
  name: z.string().min(1).max(50),
  color: colorField,
});
export type TagCreateInput = z.infer<typeof tagCreateSchema>;

export const tagUpdateSchema = tagCreateSchema.partial();
export type TagUpdateInput = z.infer<typeof tagUpdateSchema>;
