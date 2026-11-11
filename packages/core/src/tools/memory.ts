import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { ToolDefinition, ToolResult } from "@csq/core/types/tools";

// memory.* tools (G4). The Memory model stores per-(tenant, agent) facts the
// agent can recall across turns - the continuity layer beyond the chat history
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
    "Cari ingatan tentang PELANGGAN yang sedang diajak bicara - hanya memori pelanggan ini yang bisa diakses. Pakai untuk mengingat konteks dari percakapan sebelumnya dengan pelanggan yang sama.",
  category: "memory",
  parameters: memorySearchSchema,
  defaultPermission: { allowed: true, requiresApproval: false },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    // Customer scoping (owner decision 2026-11-11): a memory belongs to the
    // customer the agent is currently chatting with, resolved server-side.
    // Outside a conversation (never in practice - the agent loop always has
    // one) the search returns nothing rather than another customer's rows.
    if (!ctx.customerPhone) {
      return {
        success: false,
        error: "Tidak ada percakapan aktif - memori hanya bisa dibaca per pelanggan.",
        errorCode: "VALIDATION_ERROR",
      };
    }
    const where: Prisma.MemoryWhereInput = {
      tenantId: ctx.tenantId,
      agentId: ctx.agentId,
      customerPhone: ctx.customerPhone,
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
      customerPhone: ctx.customerPhone,
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
    "Simpan fakta tentang PELANGGAN yang sedang diajak bicara (key + value) agar bisa diingat pada percakapan berikutnya dengan pelanggan yang sama. Tidak untuk fakta umum bisnis - itu milik sumber data/pengetahuan.",
  category: "memory",
  parameters: memoryCreateSchema,
  defaultPermission: { allowed: false, requiresApproval: true },
  async handler(ctx): Promise<ToolResult> {
    const p = ctx.params;
    // The customer is stamped server-side from the conversation - the model
    // cannot choose (or see) whose memory it is writing.
    if (!ctx.customerPhone) {
      return {
        success: false,
        error: "Tidak ada percakapan aktif - memori hanya bisa dibuat dalam percakapan pelanggan.",
        errorCode: "VALIDATION_ERROR",
      };
    }
    // Read the existing memory (if any) before the upsert so the audit can
    // record a beforeValue on the update branch. On the create branch
    // beforeValue is undefined.
    const existing = await ctx.prisma.memory.findUnique({
      where: {
        tenantId_agentId_customerPhone_key: {
          tenantId: ctx.tenantId,
          agentId: ctx.agentId,
          customerPhone: ctx.customerPhone,
          key: p.key,
        },
      },
    });
    // Upsert by (tenant, agent, customer, key) - recalling a key for THIS
    // customer updates it instead of duplicating; other customers are
    // unaffected.
    const memory = await ctx.prisma.memory.upsert({
      where: {
        tenantId_agentId_customerPhone_key: {
          tenantId: ctx.tenantId,
          agentId: ctx.agentId,
          customerPhone: ctx.customerPhone,
          key: p.key,
        },
      },
      create: {
        tenantId: ctx.tenantId,
        agentId: ctx.agentId,
        customerPhone: ctx.customerPhone,
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
      beforeValue: existing ? serializeMemory(existing) : undefined,
      afterValue: serializeMemory(memory),
      customerPhone: ctx.customerPhone,
    });
    return { success: true, data: serializeMemory(memory) };
  },
};

export const memoryTools: ToolDefinition<any>[] = [memorySearch, memoryCreate];
