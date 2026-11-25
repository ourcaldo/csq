import { z } from "zod";

// PRD 31: the fixed category vocabulary. Stored as displayed (Indonesian);
// null displays and filters as "Umum". Editable in code, not by tenants.
export const KNOWLEDGE_CATEGORIES = [
  "Umum",
  "Produk",
  "Pengiriman",
  "Pembayaran",
  "Kebijakan",
  "Layanan",
] as const;
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export const knowledgeCategorySchema = z.enum(KNOWLEDGE_CATEGORIES);

export const knowledgeCreateSchema = z.object({
  type: z.enum(["FAQ", "POLICY", "BUSINESS_INFO"]),
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  category: knowledgeCategorySchema.optional(),
});
export type KnowledgeCreateInput = z.infer<typeof knowledgeCreateSchema>;

// PRD 31: a multi-pair FAQ entry. 1 to 20 pairs; every pair must be complete.
export const knowledgeQaPairSchema = z.object({
  q: z.string().trim().min(1).max(300),
  a: z.string().trim().min(1),
});
export const knowledgePairsSchema = z
  .array(knowledgeQaPairSchema)
  .min(1, "FAQ butuh minimal satu pasangan Q&A.")
  .max(20, "Maksimal 20 pasangan Q&A per entri.");

export const knowledgeCreateFaqSchema = z.object({
  type: z.literal("FAQ"),
  pairs: knowledgePairsSchema,
  category: knowledgeCategorySchema.optional(),
});
export type KnowledgeCreateFaqInput = z.infer<typeof knowledgeCreateFaqSchema>;

// Create accepts either shape; try the FAQ-pairs body first (the legacy
// schema requires title + content, so the two never both match).
export const knowledgeCreateAnySchema = z.union([
  knowledgeCreateFaqSchema,
  knowledgeCreateSchema,
]);

export const knowledgeUpdateSchema = knowledgeCreateSchema.partial();
export type KnowledgeUpdateInput = z.infer<typeof knowledgeUpdateSchema>;

// Update accepts a full FAQ pair-set replacement (all pairs, not a diff) or
// the legacy partial single-row body.
export const knowledgeUpdateFaqSchema = z.object({
  type: z.literal("FAQ"),
  pairs: knowledgePairsSchema,
  category: knowledgeCategorySchema.optional(),
});
export const knowledgeUpdateAnySchema = z.union([
  knowledgeUpdateFaqSchema,
  knowledgeUpdateSchema,
]);

// FEA-1 (PRD 16): knowledge document upload (PDF/DOCX). Same base64 JSON
// transport as the Excel import (the Pages Router body parser has no multipart
// support); the client posts { filename, base64, title? }.
export const knowledgeUploadSchema = z.object({
  filename: z.string().min(1).max(200),
  base64: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
});
export type KnowledgeUploadInput = z.infer<typeof knowledgeUploadSchema>;
