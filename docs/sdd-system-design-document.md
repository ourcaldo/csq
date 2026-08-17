# System Design Document (SDD)
## UMKM Agent Workspace

**Document version:** 1.0
**Date:** 2026-08-16
**Status:** Complete
**Standards:** IEEE 1016-2009 (adapted)
**Companion documents:**
- `./prd-product-requirements-document.md` — Product Requirements Document (PRD)
- `./srs-software-requirements-specification.md` — Software Requirements Specification (SRS)
- `../plans/` — Implementation plans (11 phase files)
- `../AGENTS.md` — Project engineering rules

---

## Cross-Reference Convention

Each design section traces to the SRS requirement(s) it satisfies using `[SRS FR-XX-NNN]`
or `[SRS NFR-XX-NNN]` notation. The PRD trace is provided where the design decision
originates from a specific PRD section.

---

## Table of Contents

1. Introduction
2. System Architecture
3. Data Design
4. Component Design
5. Interface Design
6. Detailed Design (Algorithms & Flows)
7. Security Design
8. Deployment Design

------------------------------------------------------------------------

## 1. Introduction

### 1.1 Purpose

This document describes the software architecture and design of the UMKM Agent
Workspace. It defines how the system is structured, how components interact,
how data is stored, and how the requirements in the SRS are satisfied through
design decisions.

This is the "how" document. The SRS is the "what." The PRD is the "why."

### 1.2 Scope [PRD §1, SRS §1.2]

The design covers the complete HackFest MVP: a single Next.js application
serving dashboard UI and Tool Gateway API routes, backed by PostgreSQL with
pgvector, integrated with OpenClaw as the agent runtime and WhatsApp Cloud API
as the customer channel.

### 1.3 References

1. `./prd-product-requirements-document.md` — PRD
2. `./srs-software-requirements-specification.md` — SRS
3. `../AGENTS.md` — Engineering rules
4. `../plans/` — Phase plans
5. Next.js Pages Router documentation
6. Prisma ORM documentation
7. pgvector documentation
8. Auth.js (NextAuth) v4 documentation
9. WhatsApp Cloud API documentation
10. Google Sheets API documentation
11. OpenClaw documentation (HackFest-provided)

### 1.4 Design Goals

| Goal | How Achieved |
|------|-------------|
| Tenant isolation | `tenant_id` on every table + Postgres RLS + app-level filtering [SRS FR-TN-003, NFR-SE-001] |
| Permission-controlled agents | Tool Gateway as the only agent→data path, per-tool capabilities [SRS FR-TG-001, FR-CP-003] |
| Minimal process footprint | Single Next.js process + Postgres + OpenClaw on one VPS [PRD §23A, SRS NFR-PO-002] |
| AI-assisted implementation | Standard stack patterns (Pages Router, Prisma, shadcn) well-represented in training data [PRD §23A] |
| Type safety | TypeScript strict, Zod at every boundary, no `as` casting [SRS NFR-MA-001, NFR-MA-002] |

------------------------------------------------------------------------

## 2. System Architecture

### 2.1 Architecture Overview [PRD §23, SRS §2.1]

The system is a single Next.js application (Pages Router) with four logical
layers. All layers run within one Next.js process, except OpenClaw which runs
as a separate process/container.

```
┌─────────────────────────────────────────────────────────┐
│                    Customer (WhatsApp)                    │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS webhook
                         v
┌─────────────────────────────────────────────────────────┐
│              Nginx Reverse Proxy (TLS)                    │
└────────────────────────┬────────────────────────────────┘
                         │
          ┌──────────────┴───────────────┐
          v                              v
┌─────────────────────┐      ┌──────────────────────────┐
│   Next.js App        │      │   Next.js API Routes      │
│   (Dashboard UI)     │      │   (Tool Gateway + Webhooks)│
│   Pages Router       │      │   /api/tools/*            │
│   /dashboard/*       │      │   /api/webhooks/whatsapp  │
│                      │      │   /api/import/*            │
│                      │      │   /api/dashboard/*         │
│                      │      │   /api/agents/*/chat       │
└──────────┬───────────┘      └─────────────┬────────────┘
           │                                │
           │           ┌────────────────────┘
           │           │
           v           v
┌─────────────────────────────────────────────────────────┐
│              Business Context Layer                       │
│   lib/ (db, vector, auth, permissions, audit, queries)   │
│   tools/ (product, inventory, order, customer, knowledge) │
│   services/ (whatsapp, sheets, excel, openclaw)           │
└─────────────────────────────────────────────────────────┘
                         │
           ┌─────────────┴──────────────┐
           v                            v
┌─────────────────────┐    ┌──────────────────────────┐
│   PostgreSQL 16      │    │   OpenClaw Gateway        │
│   + pgvector         │    │   (Agent Runtime)         │
│   (all business data)│    │   (per-tenant cell)       │
└─────────────────────┘    └──────────────────────────┘
```

### 2.2 Single-Process Design Rationale [PRD §23A, SRS C-003]

A single Next.js process was chosen over alternatives because:

| Option | Why Not |
|--------|---------|
| Monorepo (Next.js + Fastify backend) | Two processes, two ports, more RAM, more complexity. No benefit at single-tenant scale. |
| Next.js App Router | Less stable for AI-assisted code generation; Pages Router has longer-established patterns. PRD explicitly mandates Pages Router. |
| Microservices | Overkill for a 4GB VPS with one tenant. |

The Next.js app serves:
- Dashboard pages (`/dashboard/*`) — SSR via `getServerSideProps`.
- Tool Gateway API (`/api/tools/*`) — agent-facing, permission-checked.
- Dashboard API (`/api/dashboard/*`) — owner-facing CRUD.
- Webhooks (`/api/webhooks/whatsapp`) — Meta webhook receiver.
- Import API (`/api/import/*`) — Excel upload + Sheets OAuth.

### 2.3 Open Risks in Architecture [PRD §23A, Plans §0]

| Risk | Impact | Mitigation |
|------|--------|------------|
| OpenClaw integration method unknown | Could require separate SDK process, changing the process layout | Validate against OpenClaw docs in Phase 6. If HTTP-based, our API routes ARE the tool endpoints. If SDK-based, run as separate Docker container. |
| OpenClaw RAM footprint | Could exceed 4GB budget alongside Next.js + Postgres | Test early. If >1GB, apply memory limits or optimize. Fallback: implement simplified agent loop with direct LLM API (Plans §6 fallback). |
| Embedding model/dimension | Vector column size depends on model choice | Schema supports any dimension. Default to 1536 (OpenAI `text-embedding-3-small`). Decided in Phase 1. |

### 2.4 Request Flow Summary

**Customer message flow (full detail in §6.1):**
```
Customer → WhatsApp → Meta webhook → Nginx → Next.js /api/webhooks/whatsapp
  → resolve tenant+agent → /api/agents/[id]/chat → OpenClaw
  → OpenClaw calls /api/tools/* (Tool Gateway) → response → WhatsApp reply
```

**Dashboard request flow:**
```
Owner → Browser → Nginx → Next.js page (getServerSideProps)
  → getAuthSession() → filter by tenantId → render
```

------------------------------------------------------------------------

## 3. Data Design

### 3.1 Database Overview [SRS §7, PRD §23A]

Single PostgreSQL 16 instance with the `vector` extension (pgvector). Prisma
ORM manages schema and migrations. No separate vector database, cache, or
task queue.

**SRS trace:** FR-TN-004 (tenant_id on every table), NFR-SE-001 (RLS),
FR-KN-005 (pgvector for semantic search).

### 3.2 Prisma Schema — Complete

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Enums ─────────────────────────────────────────────────

enum AgentType {
  CUSTOMER_SERVICE
}

enum AgentStatus {
  DRAFT
  ACTIVE
  PAUSED
}

enum ChannelType {
  WHATSAPP
}

enum ChannelStatus {
  CONNECTED
  DISCONNECTED
}

enum DataSourceType {
  MANUAL
  EXCEL
  GOOGLE_SHEETS
}

enum DataSourceStatus {
  ACTIVE
  INACTIVE
  ERROR
}

enum InventorySource {
  MANUAL
  EXCEL
  GOOGLE_SHEETS
}

enum OrderStatus {
  PENDING
  CONFIRMED
  CANCELLED
}

enum KnowledgeType {
  FAQ
  POLICY
  BUSINESS_INFO
}

enum MemorySource {
  CONVERSATION
  MANUAL
}

enum MemoryImportance {
  LOW
  MEDIUM
  HIGH
}

enum ApprovalStatus {
  NONE
  PENDING
  APPROVED
  REJECTED
}

// ─── Tenant ────────────────────────────────────────────────

model Tenant {
  id        String   @id @default(uuid())
  name      String
  slug      String   @unique
  settings  Json?    // source priority config, language, etc.
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  users         User[]
  agents        Agent[]
  channels      Channel[]
  products      Product[]
  orders        Order[]
  knowledge     Knowledge[]
  memories      Memory[]
  sources       DataSource[]
  auditLogs     AuditLog[]
  approvals     Approval[]
  conversations Conversation[]
}

// ─── User (Auth) ───────────────────────────────────────────

model User {
  id           String   @id @default(uuid())
  email        String   @unique
  name         String
  passwordHash String
  tenantId     String
  tenant       Tenant   @relation(fields: [tenantId], references: [id])
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  resolvedApprovals Approval[] @relation("ApprovalResolvedBy")
}

// ─── Agent ─────────────────────────────────────────────────

model Agent {
  id                String      @id @default(uuid())
  tenantId          String
  tenant            Tenant      @relation(fields: [tenantId], references: [id])
  name              String
  type              AgentType   @default(CUSTOMER_SERVICE)
  status            AgentStatus @default(DRAFT)
  instructions      String?
  openclawCellId    String?
  openclawAgentId   String?
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt

  tenant            Tenant      @relation(fields: [tenantId], references: [id])
  capabilities      AgentCapability[]
  channels          Channel[]
  memories          Memory[]
  auditLogs         AuditLog[]
  approvals         Approval[]
  orders            Order[]     @relation("OrderCreatedByAgent")
  conversations     Conversation[]

  @@index([tenantId])
}

// ─── Channel ───────────────────────────────────────────────

model Channel {
  id        String         @id @default(uuid())
  tenantId  String
  tenant    Tenant         @relation(fields: [tenantId], references: [id])
  agentId   String?
  agent     Agent?         @relation(fields: [agentId], references: [id])
  type      ChannelType    @default(WHATSAPP)
  config    Json           // phoneNumberId, verifyToken ref, etc.
  status    ChannelStatus  @default(DISCONNECTED)
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt

  @@index([tenantId])
}

// ─── Product ───────────────────────────────────────────────

model Product {
  id          String   @id @default(uuid())
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  name        String
  description String?
  sku         String?
  price       Decimal
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  inventory   Inventory?
  orderItems  OrderItem[]

  @@index([tenantId, sku])
  @@index([tenantId, name])
}

// ─── Inventory ─────────────────────────────────────────────

model Inventory {
  id         String           @id @default(uuid())
  tenantId   String
  productId  String           @unique
  product    Product          @relation(fields: [productId], references: [id])
  quantity   Int
  source     InventorySource  @default(MANUAL)
  sourceRef  String?          // file name, sheet ID+range
  updatedAt  DateTime         @updatedAt

  @@index([tenantId])
}

// ─── Order ─────────────────────────────────────────────────

model Order {
  id               String      @id @default(uuid())
  tenantId         String
  tenant           Tenant      @relation(fields: [tenantId], references: [id])
  customerName     String
  customerPhone    String
  status           OrderStatus @default(PENDING)
  totalAmount      Decimal
  createdByAgentId String?
  createdByAgent   Agent?      @relation("OrderCreatedByAgent", fields: [createdByAgentId], references: [id])
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt

  items OrderItem[]

  @@index([tenantId, status])
  @@index([tenantId, createdAt])
}

model OrderItem {
  id         String  @id @default(uuid())
  orderId    String
  order      Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  productId  String
  product    Product @relation(fields: [productId], references: [id])
  quantity   Int
  unitPrice  Decimal
  subtotal   Decimal
}

// ─── Knowledge ─────────────────────────────────────────────

model Knowledge {
  id        String        @id @default(uuid())
  tenantId  String
  tenant    Tenant        @relation(fields: [tenantId], references: [id])
  type      KnowledgeType
  title     String
  content   String
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt

  embedding KnowledgeEmbedding?

  @@index([tenantId, type])
}

model KnowledgeEmbedding {
  id          String                          @id @default(uuid())
  tenantId    String
  knowledgeId String                          @unique
  knowledge   Knowledge                       @relation(fields: [knowledgeId], references: [id], onDelete: Cascade)
  embedding   Unsupported("vector")           // Postgres: vector(1536)
  createdAt   DateTime                        @default(now())

  @@index([tenantId])
}

// ─── Memory ────────────────────────────────────────────────

model Memory {
  id         String           @id @default(uuid())
  tenantId   String
  tenant     Tenant           @relation(fields: [tenantId], references: [id])
  agentId    String
  agent      Agent            @relation(fields: [agentId], references: [id])
  key        String
  value      String
  source     MemorySource     @default(CONVERSATION)
  importance MemoryImportance @default(MEDIUM)
  createdAt  DateTime         @default(now())

  @@index([tenantId, agentId])
}

// ─── DataSource ────────────────────────────────────────────

model DataSource {
  id         String             @id @default(uuid())
  tenantId   String
  tenant     Tenant             @relation(fields: [tenantId], references: [id])
  type       DataSourceType
  name       String
  config     Json               // sheet ID, range, mapping, OAuth creds
  status     DataSourceStatus   @default(ACTIVE)
  lastSyncAt DateTime?
  createdAt  DateTime           @default(now())
  updatedAt  DateTime           @updatedAt

  @@index([tenantId])
}

// ─── AgentCapability (Permissions) ─────────────────────────

model AgentCapability {
  id                String  @id @default(uuid())
  agentId           String
  agent             Agent   @relation(fields: [agentId], references: [id], onDelete: Cascade)
  tool              String  // e.g. "product.read", "inventory.update"
  allowed           Boolean @default(false)
  requiresApproval  Boolean @default(false)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([agentId, tool])
}

// ─── AuditLog ──────────────────────────────────────────────

model AuditLog {
  id              String         @id @default(uuid())
  tenantId        String
  tenant          Tenant         @relation(fields: [tenantId], references: [id])
  agentId         String?
  agent           Agent?         @relation(fields: [agentId], references: [id])
  action          String         // tool name e.g. "inventory.update"
  entityType      String         // "Product", "Inventory", "Order"
  entityId        String
  beforeValue     Json?
  afterValue      Json?
  approvalStatus  ApprovalStatus @default(NONE)
  customerPhone   String?
  createdAt       DateTime       @default(now())

  @@index([tenantId, createdAt])
  @@index([tenantId, agentId])
}

// ─── Approval ──────────────────────────────────────────────

model Approval {
  id              String         @id @default(uuid())
  tenantId        String
  tenant          Tenant         @relation(fields: [tenantId], references: [id])
  agentId         String
  agent           Agent          @relation(fields: [agentId], references: [id])
  action          String
  entityType      String
  entityId        String
  proposedBefore  Json
  proposedAfter   Json
  status          ApprovalStatus @default(PENDING)
  resolvedById    String?
  resolvedBy      User?          @relation("ApprovalResolvedBy", fields: [resolvedById], references: [id])
  resolvedAt      DateTime?
  createdAt       DateTime       @default(now())

  @@index([tenantId, status])
}

// ─── Conversation ──────────────────────────────────────────

model Conversation {
  id                String   @id @default(uuid())
  tenantId          String
  tenant            Tenant   @relation(fields: [tenantId], references: [id])
  agentId           String
  agent             Agent    @relation(fields: [agentId], references: [id])
  customerPhone     String
  openclawSessionId String?
  lastMessageAt     DateTime @default(now())
  createdAt         DateTime @default(now())

  @@unique([tenantId, agentId, customerPhone])
  @@index([tenantId, agentId])
}
```

**SRS trace:**
- FR-TN-004: every model has `tenantId` or relates to one that does.
- FR-AG-003: Agent has name, type, status, instructions.
- FR-BDP-001: Product has name, description, sku, price.
- FR-BDI-001: Inventory has quantity, source, sourceRef.
- FR-BDO-001/002: Order + OrderItem with transactional relation.
- FR-KN-001/002: Knowledge with type, title, content.
- FR-KN-005: KnowledgeEmbedding with `Unsupported("vector")`.
- FR-ME-001: Memory with key, value, source, importance, agentId.
- FR-CP-003: AgentCapability with tool string, allowed, requiresApproval.
- FR-AL-001: AuditLog with all required fields.
- FR-AP-003/004: Approval with proposed before/after, status, resolvedBy.

### 3.3 Entity Relationship Summary

```
Tenant ──< User
Tenant ──< Agent ──< AgentCapability
Agent  ──< Channel
Agent  ──< Memory
Agent  ──< AuditLog
Agent  ──< Approval
Tenant ──< Product ──< Inventory
Product ──< OrderItem >── Order
Tenant ──< Order ──< OrderItem
Tenant ──< Knowledge ──< KnowledgeEmbedding
Tenant ──< DataSource
Tenant ──< AuditLog
Tenant ──< Approval
```

### 3.4 pgvector Storage Design [SRS FR-KN-005, PRD §23B.4/6]

- Embeddings stored in `KnowledgeEmbedding` table.
- Postgres column type: `vector(1536)` (dimension depends on embedding model; default 1536 for OpenAI `text-embedding-3-small`).
- Prisma declares it as `Unsupported("vector")` — Prisma cannot query it natively.
- All vector operations go through `lib/vector.ts` (see §4.3).
- `CREATE EXTENSION IF NOT EXISTS vector;` lives in the first migration SQL.

### 3.5 Postgres RLS Design [SRS NFR-SE-001, FR-TN-005]

Row-Level Security policies are added in a second migration:

```sql
-- Example policy for products table
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_products ON "Product"
  USING ("tenantId" = current_setting('app.current_tenant_id')::text);
```

- Every tenant-scoped table gets an RLS policy.
- The application sets `app.current_tenant_id` per request via
  `lib/tenant-context.ts` (see §4.1).
- RLS is a secondary enforcement layer. Application-level `tenant_id` filtering
  is the primary guard.
- For MVP single-tenant, RLS is verified but per-request enforcement may be
  simplified. Full enforcement activates when multi-tenant testing begins.

### 3.6 Data Authority and Conflict Resolution [SRS FR-CA-001, PRD §13]

- Each mutable record (`Inventory`, `Product`) tracks `source` and `updatedAt`.
- `Tenant.settings` (JSON) holds the source priority order:
  ```json
  {
    "sourcePriority": ["MANUAL", "GOOGLE_SHEETS", "EXCEL", "MEMORY"]
  }
  ```
- When the agent requests data via tools, the Tool Gateway resolves conflicts
  by preferring the higher-priority source.
- If two sources conflict and priority is ambiguous, the agent escalates to
  human — never invents an answer [SRS FR-CA-004].

------------------------------------------------------------------------

## 4. Component Design

### 4.1 Auth Module [SRS FR-AU-001 to FR-AU-007]

**Files:** `src/lib/auth.ts`, `src/lib/password.ts`, `src/lib/tenant-context.ts`,
`src/pages/api/auth/[...nextauth].ts`

**Auth.js Configuration:**
- Provider: Credentials (email + password).
- Session strategy: JWT (not database sessions — simpler for MVP).
- Callbacks:
  - `jwt`: embed `userId`, `tenantId` into the token on sign-in.
  - `session`: expose token fields to client session object.
- `NEXTAUTH_SECRET` and `NEXTAUTH_URL` from environment.

**`withAuth` HOC** (`src/lib/auth.ts`):
```ts
export function withAuth(
  gssp?: GetServerSideProps,
  options?: { required?: boolean }
): GetServerSideProps
```
- Wraps `getServerSideProps` for `/dashboard/*` pages.
- If no session and `required !== false`: redirect to `/login`.
- Passes session to the wrapped `gssp` via context.
- No Next.js middleware (overkill for a handful of routes) [PRD §23B.6].

**Password hashing** (`src/lib/password.ts`):
- `hashPassword(plain): Promise<string>` — `bcryptjs` with cost factor 10.
- `verifyPassword(plain, hash): Promise<boolean>`.
- Uses `bcryptjs` (pure JS) not `bcrypt` (native) — avoids Windows dev build issues.
- Plaintext passwords are never stored or logged.

**Tenant context** (`src/lib/tenant-context.ts`):
- `resolveTenantId(session): string` — extract tenantId from session.
- `setTenantContext(prisma, tenantId): Promise<void>` — sets
  `app.current_tenant_id` Postgres session variable for RLS.
- Called at the start of every server-side request that touches tenant data.

**`getAuthSession(request)`** (`src/lib/auth.ts`):
- Used in API routes to extract authenticated session.
- Returns `{ userId, tenantId }` or throws 401.
- Every API route that touches tenant data calls this first.

**SRS trace:** FR-AU-001 (Auth.js), FR-AU-002 (bcrypt), FR-AU-003 (route protection),
FR-AU-004 (session token), FR-AU-006 (no conversation-based identity).

### 4.2 Data Ingestion Services [SRS FR-DIE, FR-DIG]

**Files:** `src/services/excel.ts`, `src/services/sheets.ts`, `src/services/scheduler.ts`

**Excel service** (`src/services/excel.ts`):
- `parseFile(buffer: Buffer): Promise<ParsedSheet[]>` — uses `exceljs` to read
  `.xlsx`, `.xls`, `.csv`. Returns array of sheets with headers + rows.
- `detectColumns(headers: string[]): ColumnMapping[]` — infers column semantics
  from Indonesian/English headers with confidence scores:
  - `Nama Barang`, `Nama Produk`, `Product` → `name`
  - `Harga`, `Harga Jual`, `Price` → `price`
  - `Stok`, `Sisa`, `Stock` → `quantity`
  - `SKU`, `Kode` → `sku`
  - `Deskripsi`, `Description` → `description`
- Output is Zod-validated.

**Google Sheets service** (`src/services/sheets.ts`):
- `getAuthUrl(tenantId): string` — generates OAuth consent URL.
- `handleOAuthCallback(code): Promise<OAuthCredentials>` — exchanges code for tokens.
- `listSpreadsheets(credentials): Promise<Spreadsheet[]>`.
- `readSheet(spreadsheetId, range, credentials): Promise<ParsedSheet>`.
- `writeSheet(spreadsheetId, range, values, credentials): Promise<void>` — only
  when write capability is explicitly enabled [SRS FR-DIG-007].
- `refreshCredentials(credentials): Promise<OAuthCredentials>` — refreshes
  expired tokens using stored refresh token.
- Uses `googleapis` library: `google.auth.OAuth2` + `google.sheets("v4")`.
- OAuth credentials stored in `DataSource.config` (JSON column), NOT in `.env`.

**Sync scheduler** (`src/services/scheduler.ts`):
- Registers a `node-cron` job on app startup (every 15 minutes).
- For each active `GOOGLE_SHEETS` DataSource:
  - Read latest data from sheet.
  - Upsert products/inventory.
  - Update `DataSource.lastSyncAt`.
  - On failure: set `DataSource.status = ERROR`, log, retry next run.
- Runs in-process (server-side only). No Redis, no external queue [SRS C-005].

**SRS trace:** FR-DIE-001 to FR-DIE-007, FR-DIG-001 to FR-DIG-008.

### 4.3 Vector Module [SRS FR-KN-005, FR-KN-006, PRD §23B.6]

**File:** `src/lib/vector.ts`

This is the ONLY module that touches pgvector. No raw SQL for vectors anywhere else.

**Exported functions:**
```ts
upsertEmbedding(
  model: "KnowledgeEmbedding",
  recordId: string,
  tenantId: string,
  embedding: number[]
): Promise<void>
// Uses prisma.$executeRaw to INSERT ... ON CONFLICT UPDATE.

findSimilar(
  model: "KnowledgeEmbedding",
  tenantId: string,
  queryEmbedding: number[],
  options?: { threshold?: number; limit?: number; filters?: Record<string, unknown> }
): Promise<Array<{ id: string; knowledgeId: string; similarity: number }>>
// Uses prisma.$queryRaw with cosine distance operator (<=>).
// Default threshold: 0.7, default limit: 5.

deleteEmbedding(
  model: "KnowledgeEmbedding",
  recordId: string,
  tenantId: string
): Promise<void>
// Uses prisma.$executeRaw to DELETE.
```

- Prisma schema declares the column as `Unsupported("vector")`.
- Actual Postgres type: `vector(1536)`.
- All queries are tenant-scoped (filtered by `tenantId`).
- Fallback: if embeddings are unavailable, `knowledge.search` tool falls back
  to Prisma text search (`contains` filter) [SRS FR-KN-006].

### 4.4 Tool Gateway [SRS FR-TG-001 to FR-TG-008, PRD §17]

**Files:** `src/tools/index.ts`, `src/tools/execute.ts`, `src/lib/permissions.ts`,
`src/lib/audit.ts`, `src/tools/{product,inventory,order,customer,knowledge}.ts`

This is the most critical backend module. It is the ONLY path between agents
and business data [SRS FR-TG-001].

**Tool registry** (`src/tools/index.ts`):
```ts
type ToolDefinition = {
  name: string;              // e.g. "product.read"
  description: string;       // human-readable, sent to agent
  parameters: ZodSchema;     // input validation
  handler: ToolHandler;      // execution function
  category: string;          // "product", "inventory", etc.
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
  audit: (entry: AuditEntryInput) => Promise<void>;
};

type ToolResult = {
  success: boolean;
  data?: unknown;
  error?: string;
  approvalRequired?: { approvalId: string; action: string };
};
```
- Registry is a `Map<string, ToolDefinition>`.
- `registerTool(def)` — adds, validates no duplicate names.
- `getTool(name)` — returns definition or throws.
- `listTools()` — returns all (for OpenClaw registration + dashboard display).

**Permission system** (`src/lib/permissions.ts`):
```ts
type PermissionResult = {
  allowed: boolean;
  requiresApproval: boolean;
};

checkPermission(tenantId, agentId, toolName): Promise<PermissionResult>
```
- Looks up `AgentCapability` for (agentId, toolName).
- If no record: use tool's `defaultPermission`.
- Read tools default to allowed=true, requiresApproval=false.
- Write tools default to allowed=false, requiresApproval=true.
- `grantCapability(agentId, tool, allowed, requiresApproval)` — dashboard API.
- `revokeCapability(agentId, tool)` — remove override, revert to default.

**Audit logger** (`src/lib/audit.ts`):
```ts
logAction(params: {
  tenantId: string;
  agentId: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeValue?: unknown;
  afterValue?: unknown;
  approvalStatus: ApprovalStatus;
  customerPhone?: string;
}): Promise<void>
```
- Inserts into `AuditLog` table.
- Called by every tool handler after execution.
- Entries are immutable [SRS FR-AL-003].

**Tool executor** (`src/tools/execute.ts`):
```ts
executeTool(toolName: string, ctx: ToolContext): Promise<ToolResult>
```
Flow (see §6.2 for detailed pseudocode):
1. Look up tool in registry → 404 if not found.
2. Validate `ctx.params` against tool's Zod schema → reject if invalid.
3. Check permission via `permissions.checkPermission()`.
4. If not allowed → return `{ success: false, error: "Permission denied" }`.
5. If allowed + requiresApproval → create Approval record, return approval payload.
6. If allowed + no approval → call `handler(ctx)`.
7. After handler: call `ctx.audit()` with before/after values.
8. Return result.

**Individual tools** (each in own file, registered in `index.ts`):

| Tool | File | Type | Default Permission |
|------|------|------|-------------------|
| `product.read` | `product.ts` | Read | allowed, no approval |
| `product.search` | `product.ts` | Read | allowed, no approval |
| `product.update` | `product.ts` | Write | denied, approval recommended |
| `inventory.read` | `inventory.ts` | Read | allowed, no approval |
| `inventory.update` | `inventory.ts` | Write | denied, approval recommended |
| `order.read` | `order.ts` | Read | allowed, no approval |
| `order.create` | `order.ts` | Write | denied, approval recommended |
| `order.cancel` | `order.ts` | Write | denied, approval required |
| `customer.read` | `customer.ts` | Read | allowed, no approval |
| `customer.update` | `customer.ts` | Write | denied, approval recommended |
| `knowledge.search` | `knowledge.ts` | Read | allowed, no approval |

**SRS trace:** FR-TG-001 (only path), FR-TG-002 (all checks), FR-TG-003 (registry),
FR-TG-004 (execution flow), FR-TG-005 (tool list), FR-TG-006 (defaults),
FR-TG-007 (audit), FR-TG-008 (Zod validation).

### 4.5 Agent Runtime Integration [SRS FR-AG-005, PRD §4.3, §26]

**Files:** `src/services/openclaw.ts`, `src/services/prompt-builder.ts`

**OpenClaw service** (`src/services/openclaw.ts`):
```ts
createCell(params: { tenantId: string; tenantName: string }): Promise<Cell>
deleteCell(cellId: string): Promise<void>
createAgent(cellId, params: { name: string; instructions: string }): Promise<Agent>
configureTools(cellId, agentId, tools: ToolDefinition[]): Promise<void>
configureInstructions(cellId, agentId, instructions: string): Promise<void>
sendMessage(cellId, agentId, message: string, sessionId?: string): Promise<AgentResponse>
```
- All calls via HTTP to `OPENCLAW_BASE_URL` with `OPENCLAW_API_KEY` header.
- Error handling: retry on 5xx (max 3), fail fast on 4xx.
- **Integration method TBD** — must validate against OpenClaw docs (see §2.3).

**Prompt builder** (`src/services/prompt-builder.ts`):
- `buildSystemPrompt(agent: Agent, tenant: Tenant, tools: ToolDefinition[]): string`
- Assembles:
  1. Agent instructions (user-defined).
  2. Business context summary (tenant name, data sources).
  3. Available tools list with descriptions.
  4. Permission rules (what the agent can/cannot do).
  5. Language instruction (Bahasa Indonesia default).
- The prompt MUST NOT include raw credentials, tokens, or system internals.
- Business data references in the prompt are read-only context — actual writes
  happen through tools only.

**Agent provisioning flow** (on dashboard "Deploy"):
1. Create `Agent` record in DB (status: DRAFT).
2. Create/ensure OpenClaw cell for tenant.
3. Create OpenClaw agent in cell.
4. Register tools from registry (`listTools()`).
5. Configure agent instructions via prompt builder.
6. Store `openclawCellId` + `openclawAgentId` on Agent record.
7. Set status to ACTIVE.

**Fallback plan** (if OpenClaw validation fails, Plans §6):
- Implement simplified agent loop directly in Next.js:
  - Receive message → call LLM API with system prompt + tool definitions →
    parse tool calls → execute via Tool Gateway → return to LLM → respond.
- Preserves entire Tool Gateway architecture. Only the runtime changes.

### 4.6 Dashboard API Layer [SRS FR-DB-001 to FR-DB-009, PRD §15]

**Files:** `src/pages/api/dashboard/*`, `src/lib/queries.ts`

**Route structure:**
- `/api/dashboard/products/` — list, create, get, update, delete.
- `/api/dashboard/inventory/` — list, update.
- `/api/dashboard/orders/` — list, get, create, update status.
- `/api/dashboard/knowledge/` — list, create, get, update, delete.
- `/api/dashboard/memory/` — list, delete, update importance.
- `/api/dashboard/sources/` — list, delete, status, priority.
- `/api/dashboard/agents/` — list, create, get, update, deploy, pause, delete.
- `/api/dashboard/channels/` — list, connect, disconnect, test.
- `/api/dashboard/approvals/` — list, approve, reject.
- `/api/dashboard/activity/` — list audit log (filtered, paginated).

**Shared helpers** (`src/lib/queries.ts`):
- `requireTenant(session): string` — extract + validate tenantId.
- `paginate<T>(query, skip, take)` — reusable pagination wrapper.
- Common Prisma `where` clause builders for tenant filtering.

**Convention:**
- Every route calls `getAuthSession()` first → 401 if unauthenticated.
- Every route validates input with Zod before touching Prisma.
- Every query filters by `tenantId` from session — never from request body.

### 4.7 Marketing Layout (Deferred) [SRS FR-MK-001 to FR-MK-004]

**File:** `src/components/marketing/marketing-layout.tsx`

- Minimal: top nav with logo + links, footer.
- No sidebar — marketing pages are top-level, not dashboard.
- `components/marketing/` MUST NOT import from `components/dashboard/` [SRS FR-MK-003].
- Built only after all MVP functionality is complete [SRS FR-MK-004].

------------------------------------------------------------------------

## 5. Interface Design

### 5.1 API Response Envelope (Standard Convention)

All API routes (dashboard + tool gateway + import) return a standard envelope:

```ts
type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: {
    code: string;      // machine-readable, e.g. "PERMISSION_DENIED"
    message: string;   // human-readable
  };
};
```

- `success: true` → `data` is present, `error` is absent.
- `success: false` → `error` is present, `data` is absent.
- HTTP status codes align with `success`: 200/201 for success, 400/401/403/404/500 for errors.
- Error codes are consistent strings, not ad-hoc messages.

### 5.2 Tool Gateway HTTP Contract [SRS FR-TG-001 to FR-TG-008]

This is the contract between OpenClaw (agent runtime) and our Tool Gateway.

**Endpoint:** `POST /api/tools/[tool]`

**Request:**
```json
{
  "agentId": "uuid-string",
  "params": {
    // tool-specific parameters, validated by Zod
  }
}
```

**Auth:** OpenClaw API key in `Authorization` header (or session-based for
dashboard-initiated tool calls).

**Response (success):**
```json
{
  "success": true,
  "data": {
    // tool-specific result
  }
}
```

**Response (permission denied):**
```json
{
  "success": false,
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "Agent does not have permission for product.update"
  }
}
```

**Response (approval required):**
```json
{
  "success": false,
  "error": {
    "code": "APPROVAL_REQUIRED",
    "message": "This action requires owner approval"
  },
  "data": {
    "approvalId": "uuid-string",
    "action": "inventory.update",
    "proposedBefore": { "quantity": 12 },
    "proposedAfter": { "quantity": 10 }
  }
}
```

**Response (validation error):**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "params.productId is required"
  }
}
```

**Tool listing endpoint:** `GET /api/tools/`
```json
{
  "success": true,
  "data": [
    {
      "name": "product.read",
      "description": "Get a product by ID or name",
      "parameters": { /* JSON schema */ },
      "category": "product",
      "defaultPermission": { "allowed": true, "requiresApproval": false }
    }
  ]
}
```

### 5.3 Full API Route Table

#### Dashboard API (owner-facing, session-authenticated)

| Method | Path | Auth | SRS Trace | Description |
|--------|------|------|-----------|-------------|
| GET | `/api/dashboard/products` | Session | FR-BDP-004 | List products (paginated) |
| POST | `/api/dashboard/products` | Session | FR-BDP-001 | Create product |
| GET | `/api/dashboard/products/[id]` | Session | FR-BDP-001 | Get single product |
| PUT | `/api/dashboard/products/[id]` | Session | FR-BDP-001 | Update product |
| DELETE | `/api/dashboard/products/[id]` | Session | FR-BDP-001 | Delete product |
| GET | `/api/dashboard/inventory` | Session | FR-BDI-001 | List inventory |
| PUT | `/api/dashboard/inventory/[productId]` | Session | FR-BDI-002 | Update stock |
| GET | `/api/dashboard/orders` | Session | FR-BDO-004 | List orders (filter by status) |
| GET | `/api/dashboard/orders/[id]` | Session | FR-BDO-004 | Get order detail |
| POST | `/api/dashboard/orders/create` | Session | FR-BDO-001 | Create order (transactional) |
| PUT | `/api/dashboard/orders/[id]` | Session | FR-BDO-004 | Update order status |
| GET | `/api/dashboard/knowledge` | Session | FR-KN-001 | List knowledge (filter by type) |
| POST | `/api/dashboard/knowledge/create` | Session | FR-KN-001 | Create knowledge entry |
| GET | `/api/dashboard/knowledge/[id]` | Session | FR-KN-002 | Get knowledge entry |
| PUT | `/api/dashboard/knowledge/[id]` | Session | FR-KN-003 | Update knowledge entry |
| DELETE | `/api/dashboard/knowledge/[id]` | Session | FR-KN-003 | Delete knowledge entry |
| GET | `/api/dashboard/memory` | Session | FR-ME-002 | List memories (filter by agent) |
| DELETE | `/api/dashboard/memory/[id]` | Session | FR-ME-002 | Delete memory |
| PUT | `/api/dashboard/memory/[id]` | Session | FR-ME-002 | Update importance |
| GET | `/api/dashboard/sources` | Session | FR-DIE-007 | List data sources |
| DELETE | `/api/dashboard/sources/[id]` | Session | FR-DIG-004 | Disconnect source |
| GET | `/api/dashboard/sources/[id]/status` | Session | FR-DIG-006 | Source sync status |
| GET | `/api/dashboard/sources/priority` | Session | FR-CA-002 | Get source priority |
| PUT | `/api/dashboard/sources/priority` | Session | FR-CA-002 | Update source priority |
| GET | `/api/dashboard/agents` | Session | FR-AG-001 | List agents |
| POST | `/api/dashboard/agents` | Session | FR-AG-001 | Create agent |
| GET | `/api/dashboard/agents/[id]` | Session | FR-AG-003 | Get agent detail |
| PUT | `/api/dashboard/agents/[id]` | Session | FR-AG-003 | Update agent config |
| POST | `/api/dashboard/agents/[id]/deploy` | Session | FR-AG-004 | Deploy agent |
| POST | `/api/dashboard/agents/[id]/pause` | Session | FR-AG-004 | Pause agent |
| DELETE | `/api/dashboard/agents/[id]` | Session | FR-AG-008 | Delete agent (DRAFT only) |
| GET | `/api/dashboard/channels` | Session | FR-WA-010 | List channels |
| POST | `/api/dashboard/channels/connect` | Session | FR-WA-010 | Connect WhatsApp |
| POST | `/api/dashboard/channels/disconnect` | Session | FR-WA-010 | Disconnect channel |
| POST | `/api/dashboard/channels/test` | Session | FR-WA-010 | Send test message |
| GET | `/api/dashboard/approvals` | Session | FR-AP-004 | List pending approvals |
| POST | `/api/dashboard/approvals/[id]/approve` | Session | FR-AP-005 | Approve action |
| POST | `/api/dashboard/approvals/[id]/reject` | Session | FR-AP-005 | Reject action |
| GET | `/api/dashboard/activity` | Session | FR-AL-002 | List audit log (filtered) |

#### Tool Gateway API (agent-facing)

| Method | Path | Auth | SRS Trace | Description |
|--------|------|------|-----------|-------------|
| GET | `/api/tools/` | API Key | FR-TG-003 | List available tools |
| POST | `/api/tools/[tool]` | API Key | FR-TG-004 | Execute a tool call |

#### Webhook API (external-facing)

| Method | Path | Auth | SRS Trace | Description |
|--------|------|------|-----------|-------------|
| GET | `/api/webhooks/whatsapp` | Verify Token | FR-WA-002, FR-WA-003 | Meta webhook verification |
| POST | `/api/webhooks/whatsapp` | Meta signature | FR-WA-002, FR-WA-004 | Receive WhatsApp messages |

#### Import API (owner-facing, session-authenticated)

| Method | Path | Auth | SRS Trace | Description |
|--------|------|------|-----------|-------------|
| POST | `/api/import/excel` | Session | FR-DIE-001 | Upload + parse + preview mapping |
| POST | `/api/import/excel/confirm` | Session | FR-DIE-006 | Confirm mapping + import |
| GET | `/api/import/sheets/auth` | Session | FR-DIG-001 | Redirect to Google OAuth |
| GET | `/api/import/sheets/callback` | OAuth | FR-DIG-001 | Handle OAuth callback |
| POST | `/api/import/sheets/connect` | Session | FR-DIG-002, FR-DIG-003 | Select sheet + preview mapping |
| POST | `/api/import/sheets/confirm` | Session | FR-DIG-004 | Confirm connection |
| POST | `/api/import/sheets/sync` | Session | FR-DIG-005 | Manual sync trigger |

#### Auth API

| Method | Path | Auth | SRS Trace | Description |
|--------|------|------|-----------|-------------|
| GET/POST | `/api/auth/[...nextauth]` | None | FR-AU-001 | Auth.js sign-in/sign-out/callback |

#### Agent Chat API

| Method | Path | Auth | SRS Trace | Description |
|--------|------|------|-----------|-------------|
| POST | `/api/agents/[agentId]/chat` | Internal | FR-CS-001 | Send message to agent (called by webhook) |

#### Health Check

| Method | Path | Auth | SRS Trace | Description |
|--------|------|------|-----------|-------------|
| GET | `/api/health` | None | NFR-RA-001 | Health check for Docker/monitoring |

### 5.4 WhatsApp Webhook Payload Contract [SRS FR-WA-002, FR-WA-004]

**GET verification:**
- Query params: `hub.mode`, `hub.challenge`, `hub.verify_token`.
- If `hub.mode === "subscribe"` and `hub.verify_token === WHATSAPP_VERIFY_TOKEN`:
  return `hub.challenge` as plain text, status 200.
- Otherwise: return 403.

**POST message event (simplified, Zod-validated):**
```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "...",
      "changes": [
        {
          "value": {
            "messages": [
              {
                "from": "628123456789",
                "id": "wamid.xxx",
                "type": "text",
                "text": { "body": "Kak, arabica 250g masih ada?" }
              }
            ]
          }
        }
      ]
    }
  ]
}
```
- Extracted fields: `from` (customer phone), `text.body` (message), `id` (message ID).
- Only `type: "text"` is processed. Other types are acknowledged (200) and ignored.
- Invalid payloads: return 200 (prevent Meta retries), log the issue.

### 5.5 OpenClaw Integration Interface (TBD) [SRS §5.3, PRD §23A]

**Status:** Pending validation against OpenClaw documentation.

**Assumed interface (HTTP-based):**
- `POST {OPENCLAW_BASE_URL}/cells` — create cell.
- `DELETE {OPENCLAW_BASE_URL}/cells/{id}` — delete cell.
- `POST {OPENCLAW_BASE_URL}/cells/{id}/agents` — create agent.
- `PUT {OPENCLAW_BASE_URL}/cells/{id}/agents/{aid}/tools` — register tools.
- `PUT {OPENCLAW_BASE_URL}/cells/{id}/agents/{aid}/instructions` — set prompt.
- `POST {OPENCLAW_BASE_URL}/cells/{id}/agents/{aid}/messages` — send message.
- Auth: `Authorization: Bearer {OPENCLAW_API_KEY}`.

**If OpenClaw is SDK-based or in-process:** the `src/services/openclaw.ts` module
adapts to call the SDK instead of HTTP. The rest of the system is unaffected
because all OpenClaw interaction is centralized in this one module.

### 5.6 Internal Module Interfaces

**`lib/db.ts`:**
```ts
export const prisma: PrismaClient;  // singleton, the only PrismaClient instance
```

**`lib/auth.ts`:**
```ts
export function withAuth(gssp?, options?): GetServerSideProps;
export const requireAuth: GetServerSideProps;  // withAuth() with defaults
export function getAuthSession(req): Promise<{ userId: string; tenantId: string }>;
```

**`lib/permissions.ts`:**
```ts
export function checkPermission(tenantId, agentId, toolName): Promise<PermissionResult>;
export function grantCapability(agentId, tool, allowed, requiresApproval): Promise<void>;
export function revokeCapability(agentId, tool): Promise<void>;
```

**`lib/audit.ts`:**
```ts
export function logAction(params: AuditEntryInput): Promise<void>;
```

**`lib/vector.ts`:**
```ts
export function upsertEmbedding(model, recordId, tenantId, embedding): Promise<void>;
export function findSimilar(model, tenantId, queryEmbedding, options?): Promise<SimilarResult[]>;
export function deleteEmbedding(model, recordId, tenantId): Promise<void>;
```

**`lib/tenant-context.ts`:**
```ts
export function resolveTenantId(session): string;
export function setTenantContext(prisma, tenantId): Promise<void>;
```

**`tools/index.ts`:**
```ts
export function registerTool(def: ToolDefinition): void;
export function getTool(name: string): ToolDefinition;
export function listTools(): ToolDefinition[];
```

**`tools/execute.ts`:**
```ts
export function executeTool(toolName: string, ctx: ToolContext): Promise<ToolResult>;
```

------------------------------------------------------------------------

## 6. Detailed Design (Algorithms & Flows)

### 6.1 End-to-End Message Data Flow [SRS FR-CS-001 to FR-CS-007, FR-WA-001 to FR-WA-008]

```
1. Customer sends WhatsApp message
2. Meta delivers to: POST /api/webhooks/whatsapp
3. Webhook handler:
   a. Zod-validate payload → if invalid, return 200, log, exit
   b. Extract: from (phone), text.body (message), id (message ID)
   c. Return 200 immediately (Meta timeout avoidance)
4. Resolve tenant + agent:
   a. Look up sender phone in Channel table
   b. Match to tenant's WhatsApp channel
   c. Find ACTIVE agent for that channel
   d. If no active agent → send "Agent sedang tidak aktif" → exit
5. Forward to: POST /api/agents/[agentId]/chat
   a. Load agent + tenant context
   b. Set tenant context (RLS session var)
   c. Build system prompt (prompt-builder.ts)
   d. Send to OpenClaw: openclaw.sendMessage(cellId, agentId, message, sessionId)
6. OpenClaw processes message:
   a. Agent interprets intent
   b. Agent decides to call a tool (e.g., "product.search")
   c. OpenClaw calls: POST /api/tools/product.search
7. Tool Gateway executes:
   a. Look up tool in registry
   b. Validate params with Zod
   c. checkPermission(tenantId, agentId, "product.search")
   d. If allowed + no approval → call handler
   e. Handler queries Prisma (filtered by tenantId) → returns product
   f. Log audit entry (read = info level)
   g. Return { success: true, data: product }
8. OpenClaw receives tool result:
   a. Agent may call additional tools (e.g., inventory.read)
   b. Repeat steps 7 for each tool call
   c. Agent composes final response
9. Agent response returned to chat handler
10. Chat handler sends response via WhatsApp:
    a. whatsapp.sendText(phoneNumberId, customerPhone, response)
    b. whatsapp.markAsRead(phoneNumberId, messageId)
11. Conversation logged
12. Audit entries persisted for any write operations
```

### 6.2 Permission Checking Algorithm [SRS FR-CP-001 to FR-CP-008, FR-TG-004]

```
function executeTool(toolName, ctx):
  1. tool = registry.get(toolName)
     if tool not found → return error("TOOL_NOT_FOUND")

  2. validated = tool.parameters.safeParse(ctx.params)
     if not validated → return error("VALIDATION_ERROR", details)

  3. perm = checkPermission(ctx.tenantId, ctx.agentId, toolName)
     // checkPermission:
     //   a. Look up AgentCapability where agentId + tool
     //   b. If found → return { allowed, requiresApproval }
     //   c. If not found → return tool.defaultPermission

  4. if not perm.allowed:
     logAudit(action=toolName, approvalStatus=NONE, result="DENIED")
     return error("PERMISSION_DENIED")

  5. if perm.requiresApproval:
     approval = createApprovalRecord(ctx, tool, validated.data)
     logAudit(action=toolName, approvalStatus=PENDING)
     return { success: false, data: { approvalId, proposedBefore, proposedAfter } }

  6. result = tool.handler(ctx with validated.data)
  7. logAudit(action=toolName, approvalStatus=NONE,
              beforeValue, afterValue, result)
  8. return result
```

### 6.3 Approval Workflow Flow [SRS FR-AP-001 to FR-AP-008]

```
Agent requests write action (e.g., inventory.update):
  → Tool Gateway: checkPermission → allowed=true, requiresApproval=true
  → Create Approval record (status: PENDING, proposedBefore, proposedAfter)
  → Return approval-required payload to agent
  → Agent tells customer: "Sedang menunggu persetujuan"

Owner views dashboard → /dashboard/approvals:
  → GET /api/dashboard/approvals → list PENDING approvals
  → Owner clicks Approve:
    → POST /api/dashboard/approvals/[id]/approve
    → Execute original action (tool.handler)
    → Update Approval: status=APPROVED, resolvedBy, resolvedAt
    → Log audit: approvalStatus=APPROVED, before/after values
    → (Optional) Notify agent/customer that action completed

  → Owner clicks Reject:
    → POST /api/dashboard/approvals/[id]/reject
    → Update Approval: status=REJECTED, resolvedBy, resolvedAt
    → Log audit: approvalStatus=REJECTED
    → Do NOT execute action
    → (Optional) Notify agent/customer that action was declined
```

### 6.4 Google Sheets Sync Flow [SRS FR-DIG-006, NFR-PE-004]

```
node-cron triggers (every 15 minutes):
  1. Query all DataSource where type=GOOGLE_SHEETS and status=ACTIVE
  2. For each source:
     a. Check OAuth credentials → refresh if expired
     b. Read latest data: sheets.readSheet(spreadsheetId, range, creds)
     c. Parse rows using stored column mapping
     d. For each row:
        - Match to existing Product (by name or SKU)
        - If exists: update price/quantity (respecting source priority)
        - If new: create Product + Inventory
     e. Update DataSource.lastSyncAt = now()
     f. On success: DataSource.status remains ACTIVE
     g. On error: DataSource.status = ERROR, log error, retry next cycle
  3. Log sync summary (sources checked, rows updated, errors)
```

### 6.5 Conflict Resolution Flow [SRS FR-CA-001 to FR-CA-004]

```
Agent requests data (e.g., inventory.read for "Arabica 250g"):
  1. Tool queries Inventory where tenantId + productId
  2. If multiple sources have data for same product:
     a. Read Tenant.settings.sourcePriority (e.g., ["MANUAL", "GOOGLE_SHEETS", "EXCEL"])
     b. Find the record from the highest-priority source
     c. Return that record's value
  3. If sources conflict AND priority is ambiguous (same priority):
     a. Compare updatedAt timestamps → prefer most recent
     b. If still ambiguous → return error to agent
     c. Agent escalates: "Saya perlu konfirmasi stok terbaru, Kak."
  4. NEVER invent a value — always escalate if uncertain.
```

### 6.6 Error Handling Strategy (3 Layers) [SRS NFR-RA-003, NFR-RA-004]

**Layer 1 — Customer-facing (WhatsApp):**
- Tool failure: "Maaf, sedang ada kendala teknis. Silakan coba lagi nanti."
- Permission denied: "Maaf, saya tidak bisa melakukan itu." (specific to action)
- Agent offline: "Agent sedang tidak aktif."
- Generic errors: never expose internal details, stack traces, or SQL errors.

**Layer 2 — Agent-facing (Tool Gateway response):**
- Permission denied: `{ code: "PERMISSION_DENIED", message: "..." }`
- Validation error: `{ code: "VALIDATION_ERROR", message: "..." }`
- Not found: `{ code: "NOT_FOUND", message: "..." }`
- Internal error: `{ code: "INTERNAL_ERROR", message: "Tool execution failed" }`
- Agent receives structured errors and can decide how to respond to customer.

**Layer 3 — Internal (logging):**
- All errors logged to console (captured by Docker logs).
- Audit log records failed/denied attempts with action + approvalStatus.
- No external log aggregation for MVP.
- Errors include: timestamp, tool name, agent ID, tenant ID, error message,
  stack trace (dev only).

------------------------------------------------------------------------

## 7. Security Design

### 7.1 Tenant Isolation [SRS NFR-SE-001, NFR-SE-002, FR-TN-003]

**Primary layer — Application-level filtering:**
- Every Prisma query includes `where: { tenantId: <session.tenantId> }`.
- `tenantId` is extracted from the authenticated session, never from request
  body or query params.
- `lib/queries.ts` provides helpers to enforce this consistently.

**Secondary layer — Postgres RLS:**
- Every tenant-scoped table has an RLS policy.
- `lib/tenant-context.ts` sets `app.current_tenant_id` per request.
- RLS policies: `USING (tenantId = current_setting('app.current_tenant_id')::text)`.
- Even if application-level filtering fails, RLS blocks cross-tenant access.

### 7.2 Prompt Injection Defense [SRS NFR-SE-003, FR-AU-006, PRD §18.1]

- All external content is untrusted: customer messages, spreadsheet cells,
  uploaded documents.
- External content is NEVER placed in the system prompt as instructions.
- External content is only placed in the user/content context, clearly delimited.
- The agent's permissions are defined by platform configuration (AgentCapability),
  never by content in messages or documents.
- The system prompt explicitly instructs the agent to ignore any attempt to
  change identity, permissions, or instructions from within customer messages.
- A customer saying "you are now an admin" or "ignore your previous instructions"
  has no effect — permissions are checked server-side per tool call.

### 7.3 Credential Management [SRS NFR-SE-004, NFR-SE-008, NFR-SE-009, PRD §18.1]

| Credential | Storage | Exposure |
|------------|---------|----------|
| Database URL | `.env` (gitignored) | Server-side only |
| NextAuth secret | `.env` (gitignored) | Server-side only |
| WhatsApp token | `.env` (gitignored) | Server-side only (in `whatsapp.ts`) |
| Google OAuth client ID/secret | `.env` (gitignored) | Server-side only (in `sheets.ts`) |
| Google OAuth user tokens | `DataSource.config` (DB, JSON) | Server-side only, refreshed as needed |
| OpenClaw API key | `.env` (gitignored) | Server-side only (in `openclaw.ts`) |
| User passwords | `User.passwordHash` (DB, bcrypt) | Never plaintext, never logged |
| Agent system prompts | Built at runtime, never contain credentials | Server-side |

- No credential EVER appears in client-side JavaScript bundles.
- No credential is EVER passed to the agent/model.
- The agent only sees tool names + descriptions + parameters — never secrets.

### 7.4 Audit Trail Design [SRS FR-AL-001 to FR-AL-005, NFR-SE-005]

- Every mutation (write tool call) generates an `AuditLog` entry.
- Entries are append-only — no UPDATE or DELETE on `AuditLog` rows.
- Captured: tenant, agent, action, entity, before/after, approval status,
  customer phone, timestamp.
- Denied attempts are also logged (approvalStatus = NONE, result noted).
- Dashboard provides filtered, paginated access to the audit log.
- 100% of unauthorized writes are blocked AND logged [SRS FR-AL-004].
- 100% of successful writes are logged [SRS FR-AL-005].

### 7.5 Agent Read-Only by Default [SRS FR-CP-004, NFR-SE-006]

- All read tools default to `allowed: true, requiresApproval: false`.
- All write tools default to `allowed: false, requiresApproval: true`.
- Owner must explicitly enable each write tool per agent.
- Even when enabled, approval may still be required per tool.
- This is the "Read by default. Write by permission. Act by policy." principle
  [PRD §27].

------------------------------------------------------------------------

## 8. Deployment Design

### 8.1 Container Architecture [SRS NFR-PO-001, PRD §23A, §22A]

```
┌─────────────────────────────────────────────────────────┐
│                  Ubuntu VPS (4 vCPU, 4GB RAM)             │
│                                                          │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │  Nginx   │───▶│  Next.js App │───▶│ PostgreSQL   │   │
│  │  (TLS)   │    │  (Port 3000) │    │  + pgvector  │   │
│  │  :80:443 │    │              │    │  (Port 5432) │   │
│  └──────────┘    └──────┬───────┘    └──────────────┘   │
│                         │                               │
│                         v                               │
│                  ┌──────────────┐                       │
│                  │ OpenClaw     │                       │
│                  │ Gateway      │                       │
│                  │ (TBD port)   │                       │
│                  └──────────────┘                       │
│                                                          │
│  Certbot container (periodic TLS renewal)               │
└─────────────────────────────────────────────────────────┘
```

### 8.2 Dockerfile Design [PRD §23B.1, Plans §10.1]

Multi-stage build:
- **Builder stage:** Node 20 Alpine, install deps, `prisma generate`, `npm run build`.
- **Runner stage:** Node 20 Alpine, standalone Next.js output, copy Prisma client,
  EXPOSE 3000, `CMD ["node", "server.js"]`.
- `next.config.js` set to `output: "standandalone"` for minimal runtime image.

### 8.3 Docker Compose Services [Plans §10.2]

| Service | Image | Ports | Depends On | Restart |
|---------|-------|-------|------------|---------|
| `app` | Built from Dockerfile | 127.0.0.1:3000 | postgres (healthy) | unless-stopped |
| `postgres` | `pgvector/pgvector:pg16` | 127.0.0.1:5432 | — | unless-stopped |
| `nginx` | Built from `docker/nginx/` | 80, 443 | app | unless-stopped |
| `certbot` | `certbot/certbot` | — | nginx (one-shot/renewal) | — |
| `openclaw` | TBD (pending validation) | TBD | app | unless-stopped |

- Postgres binds to `127.0.0.1` only (not exposed publicly).
- App binds to `127.0.0.1` only (Nginx proxies to it).
- Nginx is the only publicly exposed service (80 + 443).

### 8.4 Nginx Configuration [Plans §10.3]

- Reverse proxy: `location / { proxy_pass http://app:3000; }`.
- WebSocket support (for future real-time features).
- Gzip compression for static assets.
- Security headers: X-Frame-Options, X-Content-Type-Options, etc.
- Rate limiting on `/api/webhooks/*` (prevent webhook abuse).
- TLS certificates from Let's Encrypt (mounted from Certbot volume).

### 8.5 TLS Setup [Plans §10.4, SRS FR-WA-002]

- Certbot obtains certificates via webroot challenge.
- `init-certbot.sh` script for initial certificate acquisition.
- Renewal via cron or systemd timer on the VPS.
- TLS is REQUIRED — WhatsApp webhook requires HTTPS [PRD §23A].
- HTTP (port 80) redirects to HTTPS (port 443).

### 8.6 Resource Budget [SRS NFR-PO-002, Plans §10]

| Component | Estimated RAM | Notes |
|-----------|--------------|-------|
| PostgreSQL + pgvector | 300-500 MB | Tuned for small dataset |
| Next.js app | 200-400 MB | Includes node-cron |
| Nginx | ~20 MB | Minimal |
| OpenClaw Gateway | 200-500 MB | TBD — pending validation |
| OS overhead | ~200 MB | Ubuntu base |
| **Total (without OpenClaw)** | **~820-1020 MB** | |
| **Total (with OpenClaw)** | **~1020-1520 MB** | Headroom under 4GB |

- If OpenClaw exceeds 1GB, apply Docker memory limits or optimize.
- Postgres `shared_buffers` tuned down for 4GB host (e.g., 256MB).
- No swap file initially; add if OOM events occur.

### 8.7 Health Check & Monitoring [SRS NFR-RA-001, Plans §10.8]

- `GET /api/health` → `{ status: "ok", timestamp }` if app + DB reachable.
- Docker healthcheck on app service uses this endpoint.
- Postgres healthcheck: `pg_isready -U umkm`.
- `docker compose logs -f app` for real-time log viewing.
- No external monitoring (Datadog, ELK) for MVP.

### 8.8 Database Migration Strategy [Plans §10.7]

- Production: `npx prisma migrate deploy` (non-interactive).
- Run as a pre-start step or docker-compose entrypoint script.
- NEVER run `prisma migrate dev` in production.
- Seed script (`prisma/seed.ts`) runs manually for demo data setup.

### 8.9 VPS Setup Script [Plans §10.5]

`docker/setup-vps.sh` performs:
1. Update system packages.
2. Install Docker + Docker Compose.
3. Clone/copy project files.
4. Copy `.env.production` to server.
5. `docker compose -f docker/docker-compose.yml up -d`.
6. `npx prisma migrate deploy`.
7. (Optional) `npx prisma db seed` for demo data.
8. Configure firewall: allow 80 + 443 only.
- Script is idempotent (safe to re-run).

### 8.10 Backup Strategy (Minimal) [Plans §10.10]

- Manual: `docker exec postgres pg_dump -U umkm umkm_prod > backup.sql`.
- Documented in README.
- No automated backups for MVP.

------------------------------------------------------------------------

**End of SDD.** This document, together with the SRS and PRD, provides complete
traceability from product vision (PRD) → formal requirements (SRS) → system
design (SDD) → implementation plans (`../plans/`).
