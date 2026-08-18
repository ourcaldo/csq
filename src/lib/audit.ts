import { Prisma } from "@prisma/client";
import type { ApprovalStatus } from "@prisma/client";
import prisma from "@/lib/db";

export type AuditLogInput = {
  tenantId: string;
  agentId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeValue?: Prisma.InputJsonValue;
  afterValue?: Prisma.InputJsonValue;
  approvalStatus: ApprovalStatus;
  customerPhone?: string;
};

// Append-only audit (SDD §4.4 / §6.6). Only create() is ever called — there is
// no UPDATE or DELETE path on AuditLog, so entries are immutable [FR-AL-003].
// Denied and pending attempts are logged here too, not just successful writes
// [FR-AL-004]. Undefined before/after become SQL NULL via Prisma.DbNull.
export async function logAction(input: AuditLogInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      agentId: input.agentId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeValue:
        input.beforeValue !== undefined ? input.beforeValue : Prisma.DbNull,
      afterValue:
        input.afterValue !== undefined ? input.afterValue : Prisma.DbNull,
      approvalStatus: input.approvalStatus,
      customerPhone: input.customerPhone,
    },
  });
}

// Recursively narrow an unknown value to a Prisma-Json-safe value, with no
// `as` casts. Decimal (decimal.js) and Date are pre-converted via their
// toJSON() through a JSON round-trip, so they land here as string/number.
// Returns `InputJsonValue | null` because nested object/array values may be
// null (Prisma's InputJsonObject/InputJsonArray allow null elements); the
// top-level wrapper (toJsonValue) guarantees a non-null InputJsonValue.
function toInputJson(v: unknown): Prisma.InputJsonValue | null {
  if (v === null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return v;
  }
  if (Array.isArray(v)) {
    return v.map(toInputJson);
  }
  if (typeof v === "object") {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = toInputJson(val);
    }
    return out;
  }
  return null;
}

// Convert a Prisma row (Decimal/Date-bearing) into a Prisma.InputJsonValue.
// Callers always pass objects (Prisma rows / object literals), so the
// top-level result is non-null; the ternary narrows the | null away without
// a cast.
export function toJsonValue(v: unknown): Prisma.InputJsonValue {
  const safe: unknown = JSON.parse(JSON.stringify(v));
  const r: Prisma.InputJsonValue | null = toInputJson(safe);
  return r === null ? {} : r;
}


// Human (dashboard) mutations: agentId is null, approvalStatus NONE. Use this
// from dashboard CRUD routes so human writes are audited alongside agent ones.
export async function logHuman(input: {
  tenantId: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeValue?: unknown;
  afterValue?: unknown;
}): Promise<void> {
  await logAction({
    tenantId: input.tenantId,
    agentId: null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    approvalStatus: "NONE",
    beforeValue: input.beforeValue !== undefined ? toJsonValue(input.beforeValue) : undefined,
    afterValue: input.afterValue !== undefined ? toJsonValue(input.afterValue) : undefined,
  });
}

