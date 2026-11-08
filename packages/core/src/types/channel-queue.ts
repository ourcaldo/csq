import { z } from "zod";

// Cross-process contract for ChannelCommand.result (PRD 23C Phase 6).
// Written by the worker (services/channel-runtime.ts) as it executes a
// connect, read by the dashboard routes (connect/qr) as they poll. Both
// sides parse through this schema - never trust the Json column raw.

export const channelCommandResultSchema = z.object({
  qr: z.string().nullable().optional(),
  open: z.boolean().optional(),
  closeCode: z.number().nullable().optional(),
});

export type ChannelCommandResult = z.infer<typeof channelCommandResultSchema>;
