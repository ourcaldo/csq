import { z } from "zod";

export const memoryImportanceUpdateSchema = z.object({
  importance: z.enum(["LOW", "MEDIUM", "HIGH"]),
});
export type MemoryImportanceUpdateInput = z.infer<typeof memoryImportanceUpdateSchema>;

// G4: create a memory (dashboard). agentId/key/value required; importance
// defaults to MEDIUM; source is MANUAL when created from the dashboard.
export const memoryCreateSchema = z.object({
  agentId: z.string().uuid(),
  key: z.string().min(1).max(200),
  value: z.string().min(1),
  importance: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
});
export type MemoryCreateInput = z.infer<typeof memoryCreateSchema>;
