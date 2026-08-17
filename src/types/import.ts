import { z } from "zod";

// Excel/CSV upload + column-mapping flow (PRD §8.2). The client sends the file
// as base64 JSON so no multipart parser dependency is needed; the dashboard
// reads the file with FileReader and posts { filename, base64 }.

export const excelUploadSchema = z.object({
  filename: z.string().min(1),
  base64: z.string().min(1),
});

export const columnMappingSchema = z.object({
  name: z.string().nullable(),
  price: z.string().nullable(),
  quantity: z.string().nullable(),
  sku: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export const excelConfirmSchema = z.object({
  filename: z.string().min(1),
  base64: z.string().min(1),
  mapping: columnMappingSchema,
});

export type ExcelUpload = z.infer<typeof excelUploadSchema>;
export type ColumnMapping = z.infer<typeof columnMappingSchema>;
export type ExcelConfirm = z.infer<typeof excelConfirmSchema>;
