import { z } from "zod";

export const memoryImportanceUpdateSchema = z.object({
  importance: z.enum(["LOW", "MEDIUM", "HIGH"]),
});
export type MemoryImportanceUpdateInput = z.infer<typeof memoryImportanceUpdateSchema>;

// G4: create a memory (dashboard). agentId/key/value required; importance
// defaults to MEDIUM; source is MANUAL when created from the dashboard.
// customerPhone is required since the 2026-11-11 customer-scoping change:
// every memory belongs to one customer, manual ones included - business-level
// facts belong in the knowledge base, not here.
export const memoryCreateSchema = z.object({
  agentId: z.string().uuid(),
  customerPhone: z.string().min(5).max(60),
  key: z.string().min(1).max(200),
  value: z.string().min(1),
  importance: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
});
export type MemoryCreateInput = z.infer<typeof memoryCreateSchema>;
