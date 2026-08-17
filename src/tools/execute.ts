import { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { getTool } from "@/tools";
import { checkPermission } from "@/lib/permissions";
import { logAction } from "@/lib/audit";
import type {
  AuditEntryInput,
  ExecuteOutcome,
  ToolContext,
  ApprovalPayload,
} from "@/types/tools";

// JSON-safe coercion for Prisma Json inputs. Round-tripping through JSON
// guarantees the value is JSON-serializable (drops undefined, converts Decimal
// if any slipped through) and yields a value assignable to InputJsonValue —
// without a type assertion.
function toJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v));
}

type ExecuteArgs = {
  toolName: string;
  tenantId: string;
  agentId: string;
  params: Record<string, unknown>;
  customerPhone?: string;
};

// The single entry point between agents and business data (SDD §4.4 / §6.2).
// Order: lookup tool → validate params (Zod) → check permission → (denied:
// audit + PERMISSION_DENIED) / (approval required: create Approval + audit
// PENDING + return payload, do NOT execute) / (allowed: run handler, handler
// audits its own before/after with approvalStatus stamped NONE here).
export async function executeTool(args: ExecuteArgs): Promise<ExecuteOutcome> {
  const tool = getTool(args.toolName);
  if (!tool) {
    return { kind: "tool_not_found" };
  }

  const parsed = tool.parameters.safeParse(args.params);
  if (!parsed.success) {
    return {
      kind: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Invalid parameters",
    };
  }

  const perm = await checkPermission(args.tenantId, args.agentId, args.toolName);
  if (!perm.allowed) {
    // Safety moment: an unauthorized write is blocked AND audited — never
    // executed. [FR-AL-004, PRD §27]
    await logAction({
      tenantId: args.tenantId,
      agentId: args.agentId,
      action: args.toolName,
      entityType: tool.category,
      entityId: "",
      approvalStatus: "NONE",
      customerPhone: args.customerPhone,
    });
    return { kind: "permission_denied" };
  }

  if (perm.requiresApproval) {
    // Snapshot before/after for the approval queue without executing.
    let before: Prisma.InputJsonValue = {};
    let after: Prisma.InputJsonValue = toJson(parsed.data);
    if (tool.describeChange) {
      try {
        const change = await tool.describeChange(parsed.data, {
          tenantId: args.tenantId,
          prisma,
        });
        before = change.proposedBefore;
        after = change.proposedAfter;
      } catch {
        // Keep the defaults; the approval still records the raw params.
      }
    }
    const approval = await prisma.approval.create({
      data: {
        tenantId: args.tenantId,
        agentId: args.agentId,
        action: args.toolName,
        entityType: tool.category,
        entityId: "",
        proposedBefore: before,
        proposedAfter: after,
        params: toJson(parsed.data),
        status: "PENDING",
      },
    });
    await logAction({
      tenantId: args.tenantId,
      agentId: args.agentId,
      action: args.toolName,
      entityType: tool.category,
      entityId: approval.id,
      approvalStatus: "PENDING",
      customerPhone: args.customerPhone,
    });
    const payload: ApprovalPayload = {
      approvalId: approval.id,
      action: args.toolName,
      proposedBefore: before,
      proposedAfter: after,
    };
    return { kind: "approval_required", payload };
  }

  // Allowed, no approval: run the handler. The handler calls ctx.audit with
  // before/after; this closure stamps approvalStatus = NONE and tenant/agent.
  const auditFn = (entry: AuditEntryInput): Promise<void> =>
    logAction({
      tenantId: args.tenantId,
      agentId: args.agentId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeValue: entry.beforeValue,
      afterValue: entry.afterValue,
      approvalStatus: "NONE",
      customerPhone: entry.customerPhone ?? args.customerPhone,
    });

  const ctx: ToolContext = {
    tenantId: args.tenantId,
    agentId: args.agentId,
    params: parsed.data,
    prisma,
    audit: auditFn,
  };

  try {
    const result = await tool.handler(ctx);
    return { kind: "ok", result };
  } catch (err) {
    // Log details server-side; return a generic message to the agent.
    console.error(
      `[executeTool] ${args.toolName} threw for tenant ${args.tenantId} agent ${args.agentId}:`,
      err
    );
    return { kind: "internal_error", message: "Tool execution failed" };
  }
}

type ExecuteApprovedArgs = {
  approvalId: string;
  tenantId: string;
  resolvedByUserId: string;
};

// Owner approved a pending action: re-validate the stored params and run the
// handler, stamping audit entries APPROVED. The approval is only marked
// APPROVED if the handler succeeds; on failure it stays PENDING (retryable).
// Permission is not re-checked — approval is the owner's explicit grant.
export async function executeApprovedAction(
  args: ExecuteApprovedArgs
): Promise<ExecuteOutcome> {
  const approval = await prisma.approval.findUnique({
    where: { id: args.approvalId },
  });
  if (!approval) {
    return { kind: "not_found", message: "Approval not found" };
  }
  if (approval.tenantId !== args.tenantId) {
    return { kind: "permission_denied" };
  }
  if (approval.status !== "PENDING") {
    return {
      kind: "validation_error",
      message: "Approval already resolved",
    };
  }

  const tool = getTool(approval.action);
  if (!tool) {
    return { kind: "tool_not_found" };
  }

  // Re-validate stored params (they were validated before storage, but this
  // guards against schema drift). safeParse accepts the JsonValue directly.
  const parsed = tool.parameters.safeParse(approval.params ?? {});
  if (!parsed.success) {
    return {
      kind: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Invalid stored parameters",
    };
  }

  const auditFn = (entry: AuditEntryInput): Promise<void> =>
    logAction({
      tenantId: approval.tenantId,
      agentId: approval.agentId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeValue: entry.beforeValue,
      afterValue: entry.afterValue,
      approvalStatus: "APPROVED",
      customerPhone: entry.customerPhone,
    });

  const ctx: ToolContext = {
    tenantId: approval.tenantId,
    agentId: approval.agentId ?? "",
    params: parsed.data,
    prisma,
    audit: auditFn,
  };

  try {
    const result = await tool.handler(ctx);
    await prisma.approval.update({
      where: { id: approval.id },
      data: {
        status: "APPROVED",
        resolvedById: args.resolvedByUserId,
        resolvedAt: new Date(),
      },
    });
    return { kind: "ok", result };
  } catch (err) {
    console.error(
      `[executeApprovedAction] ${approval.action} threw for approval ${approval.id}:`,
      err
    );
    return { kind: "internal_error", message: "Approved action failed to execute" };
  }
}
