import { z } from "zod";
import { moneySchema } from "@csq/core/types/money";

// PRD 32: product type drives fields and stock behavior.
// PHYSICAL and COURSE are quantity-tracked (Inventory row = stok / kuota);
// DIGITAL and DOWNLOADABLE are unlimited and carry deliveryInfo instead.
export const PRODUCT_TYPES = ["PHYSICAL", "DIGITAL", "DOWNLOADABLE", "COURSE"] as const;
export type ProductTypeValue = (typeof PRODUCT_TYPES)[number];

export const COURSE_DURATION_UNITS = ["MINGGU", "BULAN", "TAHUN"] as const;
export type CourseDurationUnitValue = (typeof COURSE_DURATION_UNITS)[number];

// Types whose availability is a quantity (they own an Inventory row).
export function isStockTracked(type: ProductTypeValue): boolean {
  return type === "PHYSICAL" || type === "COURSE";
}

export const productTypeSchema = z.enum(PRODUCT_TYPES);
export const courseDurationUnitSchema = z.enum(COURSE_DURATION_UNITS);

export const productCreateSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    sku: z.string().max(100).optional(),
    price: moneySchema,
    type: productTypeSchema.optional(),
    categoryId: z.string().uuid().optional(),
    levelId: z.string().uuid().optional(),
    // DIGITAL: voucher/akun instructions. DOWNLOADABLE: download link.
    deliveryInfo: z.string().max(2000).optional(),
    durationValue: z.number().int().min(1).max(1000).optional(),
    durationUnit: courseDurationUnitSchema.optional(),
  })
  // Duration is a pair: both fields or neither.
  .refine((v) => (v.durationValue === undefined) === (v.durationUnit === undefined), {
    message: "Durasi butuh angka dan satuan sekaligus.",
    path: ["durationUnit"],
  });
export type ProductCreateInput = z.infer<typeof productCreateSchema>;

export const productUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    sku: z.string().max(100).nullable().optional(),
    price: moneySchema.optional(),
    type: productTypeSchema.optional(),
    categoryId: z.string().uuid().nullable().optional(),
    levelId: z.string().uuid().nullable().optional(),
    deliveryInfo: z.string().max(2000).nullable().optional(),
    durationValue: z.number().int().min(1).max(1000).nullable().optional(),
    durationUnit: courseDurationUnitSchema.nullable().optional(),
  })
  .refine(
    (v) =>
      v.durationValue === undefined ||
      v.durationUnit === undefined ||
      (v.durationValue === null) === (v.durationUnit === null),
    { message: "Durasi butuh angka dan satuan sekaligus.", path: ["durationUnit"] }
  );
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

// PRD 32: tenant-defined grouping list + course level list (name-only rows).
export const productCategoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
});
export type ProductCategoryCreateInput = z.infer<typeof productCategoryCreateSchema>;

export const courseLevelCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
});
export type CourseLevelCreateInput = z.infer<typeof courseLevelCreateSchema>;
