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
