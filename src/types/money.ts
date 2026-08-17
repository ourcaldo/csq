import { z } from "zod";

// Money is stored as Postgres Decimal(12,2) / Decimal(14,2). Accept a number
// or a string of digits with up to 2 decimal places, and normalize to a string
// so Prisma receives exact precision (no float rounding at the wire boundary).
export const moneySchema = z
  .union([z.number().nonnegative(), z.string().regex(/^\d+(\.\d{1,2})?$/)])
  .transform((v) => (typeof v === "number" ? v.toFixed(2) : v));

// Output type after transform — always a string.
export type Money = z.infer<typeof moneySchema>;
