import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { ToolDefinition, ToolResult } from "@/types/tools";

// memory.* tools (G4). The Memory model stores per-(tenant, agent) facts the
// agent can recall across turns — the continuity layer beyond the chat history
// window (G10). memory.search is read-only and allowed by default;
// memory.create is a write (denied + approval by default, consistent with
// "write by permission") that upserts by (tenant, agent, key) so recalling a
// key updates it instead of duplicating.

type SerializedMemory = {
  id: string;
  key: string;
  value: string;
  source: string;
  importance: string;
};

function serializeMemory(m: {
  id: string;
  key: string;
  value: string;
  source: string;
  importance: string;
}): SerializedMemory {
  return {
    id: m.id,
    key: m.key,
    value: m.value,
    source: m.source,
    importance: m.importance,
  };
}

const memorySearchSchema = z.object({
  query: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
type MemorySearchParams = z.infer<typeof memorySearchSchema>;

const memorySearch: ToolDefinition<MemorySearchParams> = {
  name: "memory.search",
  description:
    "Cari ingatan (fakta per pelanggan/usaha) yang sudah disimpan. Pakai untuk mengingat konteks lintas percakapan.",
  category: "memory",
  parameters: memorySearchSchema,
  defaultPermission: { allowed: true, requiresApproval: false },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    const where: Prisma.MemoryWhereInput = {
      tenantId: ctx.tenantId,
      agentId: ctx.agentId,
    };
    if (p.query) {
      where.OR = [
        { key: { contains: p.query, mode: "insensitive" } },
        { value: { contains: p.query, mode: "insensitive" } },
      ];
    }
    const memories = await ctx.prisma.memory.findMany({
      where,
      orderBy: { importance: "desc", createdAt: "desc" },
      take: p.limit ?? 20,
    });
    await ctx.audit({
      action: "memory.search",
      entityType: "memory",
      entityId: p.query ?? "",
    });
    return { success: true, data: memories.map(serializeMemory) };
  },
};

const memoryCreateSchema = z.object({
  key: z.string().min(1).max(200),
  value: z.string().min(1),
  importance: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
});
type MemoryCreateParams = z.infer<typeof memoryCreateSchema>;

const memoryCreate: ToolDefinition<MemoryCreateParams> = {
  name: "memory.create",
  description:
    "Simpan sebuah fakta/ingatan (key + value) agar bisa diingat di percakapan berikutnya.",
  category: "memory",
  parameters: memoryCreateSchema,
  defaultPermission: { allowed: false, requiresApproval: true },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    // Upsert by (tenant, agent, key) — recalling a key updates it instead of
    // duplicating (relies on the Memory unique index from the gap batch).
    const memory = await ctx.prisma.memory.upsert({
      where: {
        tenantId_agentId_key: { tenantId: ctx.tenantId, agentId: ctx.agentId, key: p.key },
      },
      create: {
        tenantId: ctx.tenantId,
        agentId: ctx.agentId,
        key: p.key,
        value: p.value,
        importance: p.importance ?? "MEDIUM",
        source: "CONVERSATION",
      },
      update: {
        value: p.value,
        importance: p.importance ?? "MEDIUM",
      },
    });
    await ctx.audit({
      action: "memory.create",
      entityType: "memory",
      entityId: memory.id,
      afterValue: serializeMemory(memory),
    });
    return { success: true, data: serializeMemory(memory) };
  },
};

export const memoryTools: ToolDefinition<any>[] = [memorySearch, memoryCreate];
