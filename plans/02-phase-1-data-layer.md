# Phase 1 — Data Layer (Prisma, Schema, Vector)

**Goal:** Define the complete database schema with all models, relations,
indexes, and pgvector support. Create the Prisma client singleton and the
vector utility module.
**PRD Reference:** Sections 7, 23A (Database), 23B.4, 23B.6
**Depends On:** Phase 0

---

## Tasks

### 1.1 Prisma initialization

- [ ] `npx prisma init` in project root (creates `prisma/schema.prisma`).
- [ ] Configure datasource as PostgreSQL with `DATABASE_URL` from `.env`.
- [ ] Configure generator to output `@prisma/client` in `node_modules` (default).

### 1.2 Define core models

All models live in `prisma/schema.prisma`. Every model includes `tenant_id`.

**Tenant:**
- [ ] `Tenant` — id, name, slug, createdAt, updatedAt.

**User (Auth):**
- [ ] `User` — id, email, name, passwordHash, tenantId (FK → Tenant).
- [ ] Unique constraint on email.

**Agent:**
- [ ] `Agent` — id, tenantId, name, type (enum: `CUSTOMER_SERVICE`), status
  (enum: `DRAFT`, `ACTIVE`, `PAUSED`), instructions (text), createdAt, updatedAt.

**Channel:**
- [ ] `Channel` — id, tenantId, agentId, type (enum: `WHATSAPP`), config (json:
  stores phoneNumberId, token, verifyToken — encrypted or env-referenced),
  status (enum: `CONNECTED`, `DISCONNECTED`), createdAt.

**Product:**
- [ ] `Product` — id, tenantId, name, description, sku, price (Decimal),
  createdAt, updatedAt.
- [ ] Index on `(tenantId, sku)`.

**Inventory:**
- [ ] `Inventory` — id, tenantId, productId (FK → Product), quantity (Int),
  source (enum: `MANUAL`, `EXCEL`, `GOOGLE_SHEETS`), sourceRef (nullable string
  for tracking origin), updatedAt.
- [ ] Unique on `(tenantId, productId)`.

**Order:**
- [ ] `Order` — id, tenantId, customerName, customerPhone, status
  (enum: `PENDING`, `CONFIRMED`, `CANCELLED`), totalAmount (Decimal),
  createdByAgentId (nullable FK → Agent), createdAt, updatedAt.
- [ ] `OrderItem` — id, orderId, productId, quantity, unitPrice, subtotal.

**Knowledge:**
- [ ] `Knowledge` — id, tenantId, type (enum: `FAQ`, `POLICY`, `BUSINESS_INFO`),
  title, content (text), createdAt, updatedAt.
- [ ] `KnowledgeEmbedding` — id, tenantId, knowledgeId (FK → Knowledge),
  embedding (`Unsupported("vector")`), createdAt.
  Actual Postgres column type: `vector(1536)`.

**Memory:**
- [ ] `Memory` — id, tenantId, agentId (FK → Agent), key, value (text),
  source (enum: `CONVERSATION`, `MANUAL`), importance (enum: `LOW`, `MEDIUM`, `HIGH`),
  createdAt.

**Data Source (for tracking imports/connections):**
- [ ] `DataSource` — id, tenantId, type (enum: `MANUAL`, `EXCEL`, `GOOGLE_SHEETS`),
  name, config (json: sheet URL, file name, mapping), status
  (enum: `ACTIVE`, `INACTIVE`, `ERROR`), lastSyncAt, createdAt.

**Agent Capability (permissions):**
- [ ] `AgentCapability` — id, agentId, tool (string, e.g. `product.read`),
  allowed (Boolean), requiresApproval (Boolean).
  Unique on `(agentId, tool)`.

**Audit Log:**
- [ ] `AuditLog` — id, tenantId, agentId, action (string), entityType,
  entityId, beforeValue (json, nullable), afterValue (json, nullable),
  approvalStatus (enum: `NONE`, `PENDING`, `APPROVED`, `REJECTED`),
  customerPhone (nullable, for WhatsApp context), createdAt.
- [ ] Index on `(tenantId, createdAt)` for dashboard queries.

**Approval Queue:**
- [ ] `Approval` — id, tenantId, agentId, action, entityType, entityId,
  proposedBefore, proposedAfter, status (enum: `PENDING`, `APPROVED`, `REJECTED`),
  resolvedBy (nullable FK → User), resolvedAt, createdAt.

**Conversation (WhatsApp session tracking):**
- [ ] `Conversation` — id, tenantId, agentId (FK → Agent), customerPhone,
  openclawSessionId (nullable), lastMessageAt, createdAt.
- [ ] Unique on `(tenantId, agentId, customerPhone)` — one session per
  customer per agent.
- [ ] Index on `(tenantId, agentId)`.
- [ ] This model is created in Phase 1 (not Phase 6) because it's a data model,
  not an integration concern. Phase 6 populates it; Phase 1 defines it.

### 1.3 Enable pgvector extension

- [ ] First migration (`npx prisma migrate dev --name init`) must include
  the SQL: `CREATE EXTENSION IF NOT EXISTS vector;`
- [ ] This goes in the migration's SQL file, not in schema.prisma
  (Prisma doesn't manage extensions).

### 1.4 Embedding column workaround

- [ ] For `KnowledgeEmbedding.embedding`, use Prisma's `Unsupported("vector")`.
- [ ] Document the actual Postgres column as `vector(1536)` in a migration
  SQL comment.

### 1.5 Prisma client singleton

- [ ] Create `src/lib/db.ts`:
  ```ts
  import { PrismaClient } from "@prisma/client";
  const prisma = new PrismaClient();
  export default prisma;
  ```
- [ ] This is the only place PrismaClient is instantiated. Every query imports
  from here.

### 1.6 Vector utility module

- [ ] Create `src/lib/vector.ts` with the functions defined in PRD 23B.6:
  - `upsertEmbedding(model, recordId, tenantId, embedding)`
  - `findSimilar(model, tenantId, queryEmbedding, options?)`
  - `deleteEmbedding(model, recordId, tenantId)`
- [ ] All functions use `prisma.$queryRaw` / `prisma.$executeRaw`.
- [ ] No raw SQL outside this file — ever.

### 1.7 Seed script

- [ ] Create `prisma/seed.ts`:
  - Seed demo tenant: `Toko Kopi Nusantara` (slug: `toko-kopi-nusantara`).
  - Seed demo user: `admin@tokokopi.id` (password: hashed).
  - Seed 3 demo products: Arabica 250g, Robusta 250g, Liberica 200g.
  - Seed inventory for each product.
  - Seed 2 FAQ entries.
  - Seed 1 shipping policy, 1 return policy.
- [ ] Add seed script to `package.json`: `"prisma:seed": "ts-node prisma/seed.ts"`.
- [ ] Run seed and verify data in database.

### 1.8 Postgres RLS setup (second enforcement layer)

- [ ] Create a second migration that adds RLS policies for tenant isolation
  on key tables (Tenant, Product, Inventory, Order, Knowledge, Memory, etc.).
- [ ] Each policy: `USING (tenant_id = current_setting('app.current_tenant_id')::uuid)`.
- [ ] Create a `src/lib/tenant-context.ts` helper that sets the
  `app.current_tenant_id` Postgres session variable per request.
  > **Note:** For MVP with single tenant, RLS can be a schema-level placeholder
  > that's verified but may not be enforced per-request until multi-tenant testing.
  > The application-level `tenant_id` filtering is the primary guard.

### 1.9 API response envelope type

- [ ] Create `src/types/api.ts` with the standard response envelope
  (defined in SDD §5.1):
  ```ts
  export type ApiResponse<T = unknown> = {
    success: boolean;
    data?: T;
    error?: {
      code: string;      // e.g. "PERMISSION_DENIED", "VALIDATION_ERROR"
      message: string;
    };
  };
  ```
- [ ] Every API route in Phases 3, 4, 5 returns this shape. No ad-hoc response
  formats. Error codes are consistent strings (see SDD §5.2 for the full list).

---

## Build Gate

- [ ] `npx prisma migrate dev` — migration runs without errors.
- [ ] `npx prisma generate` — client generates without errors.
- [ ] `npm run prisma:seed` — seed populates database.
- [ ] `npm run build` — zero errors.
- [ ] `npm run lint` — zero errors.

---

## Files Created/Modified

```
prisma/
├── schema.prisma           (all models)
├── migrations/
│   ├── 2026xxxx_init/
│   │   └── migration.sql   (CREATE TABLE + pgvector extension)
│   └── 2026xxxx_rls/
│       └── migration.sql   (RLS policies)
└── seed.ts

src/
├── lib/
│   ├── db.ts               (Prisma singleton)
│   ├── vector.ts           (vector utility)
│   └── tenant-context.ts   (RLS session var helper)
└── types/
    ├── index.ts            (update with model-derived types)
    └── api.ts              (ApiResponse<T> envelope)
```

---

## Decisions (Locked)

| Decision | Resolution | Source |
|----------|------------|--------|
| Embedding dimension | **1536** — OpenAI `text-embedding-3-small` | SDD §3.4 |
| Embedding service | **Defer to Phase 6** — depends on what OpenClaw provides. Schema supports any dimension. | SDD §2.3 |
| Source priority storage | **`Tenant.settings` JSON column** — no separate model. See SDD §3.6. | SDD §3.6 |
| API response shape | **`ApiResponse<T>` envelope** — `src/types/api.ts`. See SDD §5.1. | SDD §5.1 |
