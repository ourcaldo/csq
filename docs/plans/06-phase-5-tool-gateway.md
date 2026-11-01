# Phase 5 — Tool Gateway (Registry, Permissions, Audit)

**Goal:** Build the core abstraction layer between agents and business data.
Every tool is tenant-scoped, agent-scoped, permission-checked, audited, and
validated. This is the most critical backend module — nothing talks to the agent
without it.
**PRD Reference:** Sections 9, 10, 11, 12, 17, 27
**Depends On:** Phase 1, Phase 2, Phase 3

---

## Tasks

### 5.1 Tool registry

- [ ] Create `src/tools/index.ts` — central tool registry:
  ```ts
  type ToolDefinition = {
    name: string;              // e.g. "product.read"
    description: string;       // human-readable, used by agent
    parameters: ZodSchema;     // input validation schema
    handler: ToolHandler;     // execution function
    category: string;          // e.g. "product", "inventory", "order"
    defaultPermission: {
      allowed: boolean;
      requiresApproval: boolean;
    };
  };

  type ToolHandler = (ctx: ToolContext) => Promise<ToolResult>;

  type ToolContext = {
    tenantId: string;
    agentId: string;
    params: Record<string, unknown>;
    prisma: PrismaClient;
    audit: (entry: AuditEntry) => Promise<void>;
  };

  type ToolResult = {
    success: boolean;
    data?: unknown;
    error?: string;
    approvalRequired?: ApprovalPayload;
  };
  ```
- [ ] Registry is a `Map<string, ToolDefinition>`.
- [ ] `registerTool(def: ToolDefinition)` — adds to map, validates no duplicates.
- [ ] `getTool(name: string)` — returns definition.
- [ ] `listTools()` — returns all registered tools (for OpenClaw config).

### 5.2 Permission system

- [ ] Create `src/lib/permissions.ts`:
  - `checkPermission(tenantId, agentId, toolName): PermissionResult`
  - Looks up `AgentCapability` record for (agentId, toolName).
  - If no record exists, use tool's `defaultPermission`.
  - Returns: `{ allowed: boolean, requiresApproval: boolean }`.
  - If `requiresApproval` is true, the tool returns an `approvalRequired`
    payload instead of executing.
- [ ] `grantCapability(agentId, tool, allowed, requiresApproval)` —
  dashboard API for configuring capabilities.
- [ ] `revokeCapability(agentId, tool)` — remove a capability override.

### 5.3 Audit logging

- [ ] Create `src/lib/audit.ts`:
  - `logAction(params: AuditEntryParams)` — inserts into `AuditLog` table.
  - Called by every tool handler after execution.
  - Captures: tenantId, agentId, action (tool name), entityType, entityId,
    beforeValue, afterValue, approvalStatus.
- [ ] Every mutation tool MUST call this. Read-only tools log at info level.
- [ ] No exceptions — even automatic actions are audited.

### 5.4 Tool execution middleware

- [ ] Create `src/tools/execute.ts`:
  - `executeTool(toolName, ctx): Promise<ToolResult>` — the single entry point.
  - Flow:
    1. Validate tool exists in registry.
    2. Validate input params against tool's Zod schema.
    3. Check permission (`permissions.ts`).
    4. If allowed and no approval needed: call handler.
    5. If requires approval: return approval payload (don't execute).
    6. If not allowed: return `{ success: false, error: "Permission denied" }`.
    7. After handler execution: log audit entry.
    8. Return result.
  - **Error codes** (from SDD §5.2 — use these exact strings):
    - `TOOL_NOT_FOUND` — tool name not in registry.
    - `VALIDATION_ERROR` — params failed Zod validation (include field details in message).
    - `PERMISSION_DENIED` — agent lacks capability for this tool.
    - `APPROVAL_REQUIRED` — action requires owner approval (include `approvalId` in data).
    - `INTERNAL_ERROR` — tool handler threw an exception (log details server-side, return generic message).
  - All responses use the `ApiResponse<T>` envelope from `src/types/api.ts` (SDD §5.1).

### 5.5 Tool Gateway API routes

- [ ] Create `src/pages/api/tools/[tool].ts`:
  - `POST` — receives tool call from agent (or OpenClaw).
  - Request body: `{ toolName, agentId, params }` + auth token.
  - Validates request with Zod.
  - Authenticates caller (API key or OpenClaw auth — TBD in Phase 6).
  - Calls `executeTool()`.
  - Returns result.
- [ ] Create `src/pages/api/tools/index.ts`:
  - `GET` — returns list of available tools (for OpenClaw config).

### 5.6 Implement individual tools

Each tool in its own file under `src/tools/`:

**Product tools:**
- [ ] `src/tools/product.ts`:
  - `product.read` — get product by ID or search by name.
  - `product.search` — list products with filters.
  - `product.update` — update product fields (write, approval recommended).

**Inventory tools:**
- [ ] `src/tools/inventory.ts`:
  - `inventory.read` — get stock for a product.
  - `inventory.update` — update stock quantity (write, approval recommended).

**Order tools:**
- [ ] `src/tools/order.ts`:
  - `order.read` — get order details.
  - `order.create` — create new order + update stock (write).
  - `order.cancel` — cancel order (write, approval required).

**Customer tools:**
- [ ] `src/tools/customer.ts`:
  - `customer.read` — look up customer by phone.
  - `customer.update` — update customer info (write, approval recommended).

**Knowledge tools:**
- [ ] `src/tools/knowledge.ts`:
  - `knowledge.search` — search FAQ/policies by keyword or semantic similarity.
  - Calls `lib/vector.ts` for embedding search when available, falls back to
    text search.

### 5.7 Register all tools

- [ ] In `src/tools/index.ts`, call `registerTool()` for every tool defined above.
- [ ] Verify no name conflicts.
- [ ] Default permissions:
  - All `*.read` tools: `{ allowed: true, requiresApproval: false }`.
  - All `*.update`, `*.create`, `*.cancel` tools: `{ allowed: false, requiresApproval: true }`.
  - Owner must explicitly enable write tools.

### 5.8 Approval queue API

- [ ] Create `src/pages/api/dashboard/approvals/`:
  - `index.ts` — `GET` (list pending approvals for tenant).
  - `[id]/approve.ts` — `POST` (approve an action).
  - `[id]/reject.ts` — `POST` (reject an action).
- [ ] On approval: execute the original tool call, then update approval record.
- [ ] On rejection: update approval record, log audit entry.

---

## Build Gate

- [ ] `npm run build` — zero errors.
- [ ] `npm run lint` — zero errors.
- [ ] Manual test: `POST /api/tools/product.read` with valid params → returns product.
- [ ] Manual test: `POST /api/tools/product.update` without permission → "Permission denied".
- [ ] Manual test: `POST /api/tools/product.update` with permission but approval required
  → returns approval payload, does NOT execute.
- [ ] Manual test: approve pending action → action executes, audit log entry created.

---

## Files Created/Modified

```
src/
├── tools/
│   ├── index.ts              (registry, registerTool, listTools)
│   ├── execute.ts             (middleware: validate → check → execute → audit)
│   ├── product.ts
│   ├── inventory.ts
│   ├── order.ts
│   ├── customer.ts
│   └── knowledge.ts
├── lib/
│   ├── permissions.ts        (checkPermission, grantCapability)
│   └── audit.ts              (logAction)
├── pages/api/
│   ├── tools/
│   │   ├── index.ts          (GET: list tools)
│   │   └── [tool].ts         (POST: execute tool)
│   └── dashboard/
│       └── approvals/
│           ├── index.ts
│           └── [id]/
│               ├── approve.ts
│               └── reject.ts
```

---

## Critical Notes

- **This is the bottleneck phase.** Phases 6 and 7 depend on this.
- The Tool Gateway is the ONLY path between agents and data. Agents never
  touch Prisma, never see raw SQL, never access Google Sheets directly.
- Every tool handler receives a `ToolContext` with `tenantId` and `agentId`
  pre-resolved. Handlers never extract these from params.
- OpenClaw integration (Phase 6) will call into `executeTool()` — the interface
  must be clean and well-typed.
- Tools are **provider-agnostic**: whether WhatsApp arrives via Cloud API or
  Baileys (Phase 7), the agent calls the same tools through the same gateway.
  The WhatsApp provider only affects message transport, not tool execution.
