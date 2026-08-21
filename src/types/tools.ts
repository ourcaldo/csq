// Tool Gateway shared types (SDD §4.4). The registry, executor, permissions,
// audit, and every tool module import from here so the shapes stay in sync.
//
// No `as` assertions anywhere in this layer: the registry stores an erased
// ToolDefinition (params diverge per tool, so the map value is the existential
// form) and executeTool returns a discriminated ExecuteOutcome that API routes
// map to ApiResponse + HTTP status without string-to-code casts.

import type { Prisma, PrismaClient } from "@prisma/client";
import type { ZodType } from "zod";
import type { ErrorCode } from "@/types/api";

export type ToolPermission = {
  allowed: boolean;
  requiresApproval: boolean;
};

export type PermissionResult = ToolPermission;

// Handler-facing audit input. approvalStatus is intentionally absent: the
// executor stamps it (NONE on direct success, APPROVED on owner-approved
// replay, PENDING/REJECTED handled by the executor/queue) so a handler can
// never mislabel its own audit trail. Values are Prisma JSON-input compatible.
export type AuditEntryInput = {
  action: string;
  entityType: string;
  entityId: string;
  beforeValue?: Prisma.InputJsonValue;
  afterValue?: Prisma.InputJsonValue;
  customerPhone?: string;
};

export type ApprovalPayload = {
  approvalId: string;
  action: string;
  proposedBefore: Prisma.InputJsonValue;
  proposedAfter: Prisma.InputJsonValue;
};

// A handler's own result. success:false + errorCode covers expected business
// failures (NOT_FOUND, insufficient stock) so the API route can pick the right
// HTTP status without inspecting free-form strings.
export type ToolResult = {
  success: boolean;
  data?: unknown;
  error?: string;
  errorCode?: ErrorCode;
};

export type ToolContext<P extends Record<string, unknown> = Record<string, unknown>> = {
  tenantId: string;
  agentId: string;
  params: P;
  prisma: PrismaClient;
  audit: (entry: AuditEntryInput) => Promise<void>;
  // Server-authoritative conversation routing context (G1). Never supplied by
  // the agent — resolved from the inbound conversation by the caller, like
  // tenantId. Tools use these so they never trust agent-supplied identity: e.g.
  // customer.update uses customerPhone instead of asking the model for a number
  // (prompt-injection defense), and conversation.handoff uses conversationId.
  conversationId?: string;
  customerPhone?: string;
};

export type ToolHandler<P extends Record<string, unknown> = Record<string, unknown>> = (
  ctx: ToolContext<P>
) => Promise<ToolResult>;

export type ApprovalChange = {
  proposedBefore: Prisma.InputJsonValue;
  proposedAfter: Prisma.InputJsonValue;
};

// For approval-required write tools: snapshot the current state and the
// projected result so the approval queue can show a diff before executing.
// Optional — only write tools that may require approval implement it.
export type DescribeChange<P extends Record<string, unknown> = Record<string, unknown>> = (
  params: P,
  ctx: { tenantId: string; prisma: PrismaClient }
) => Promise<ApprovalChange>;

export type ToolDefinition<P extends Record<string, unknown> = Record<string, unknown>> = {
  name: string;
  description: string;
  parameters: ZodType<P>;
  handler: ToolHandler<P>;
  category: string;
  defaultPermission: ToolPermission;
  describeChange?: DescribeChange<P>;
};

// Summary shape returned by GET /api/tools (for OpenClaw config + dashboard).
export type ToolSummary = {
  name: string;
  description: string;
  category: string;
  defaultPermission: ToolPermission;
};

// Discriminated outcome of executeTool — typed so API routes map to ApiResponse
// + HTTP status via a switch, no string-to-ErrorCode casts.
export type ExecuteOutcome =
  | { kind: "ok"; result: ToolResult }
  | { kind: "tool_not_found" }
  | { kind: "not_found"; message: string }
  | { kind: "validation_error"; message: string }
  | { kind: "permission_denied" }
  | { kind: "approval_required"; payload: ApprovalPayload }
  | { kind: "internal_error"; message: string };
