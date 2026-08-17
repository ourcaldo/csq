import { z } from "zod";

export const memoryImportanceUpdateSchema = z.object({
  importance: z.enum(["LOW", "MEDIUM", "HIGH"]),
});
export type MemoryImportanceUpdateInput = z.infer<typeof memoryImportanceUpdateSchema>;
