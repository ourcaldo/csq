import { z } from "zod";

export const knowledgeCreateSchema = z.object({
  type: z.enum(["FAQ", "POLICY", "BUSINESS_INFO"]),
  title: z.string().min(1).max(200),
  content: z.string().min(1),
});
export type KnowledgeCreateInput = z.infer<typeof knowledgeCreateSchema>;

export const knowledgeUpdateSchema = knowledgeCreateSchema.partial();
export type KnowledgeUpdateInput = z.infer<typeof knowledgeUpdateSchema>;
