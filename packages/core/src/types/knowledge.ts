import { z } from "zod";

export const knowledgeCreateSchema = z.object({
  type: z.enum(["FAQ", "POLICY", "BUSINESS_INFO"]),
  title: z.string().min(1).max(200),
  content: z.string().min(1),
});
export type KnowledgeCreateInput = z.infer<typeof knowledgeCreateSchema>;

export const knowledgeUpdateSchema = knowledgeCreateSchema.partial();
export type KnowledgeUpdateInput = z.infer<typeof knowledgeUpdateSchema>;

// FEA-1 (PRD 16): knowledge document upload (PDF/DOCX). Same base64 JSON
// transport as the Excel import (the Pages Router body parser has no multipart
// support); the client posts { filename, base64, title? }.
export const knowledgeUploadSchema = z.object({
  filename: z.string().min(1).max(200),
  base64: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
});
export type KnowledgeUploadInput = z.infer<typeof knowledgeUploadSchema>;
