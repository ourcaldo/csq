# Phase 3 — Business Data CRUD + Knowledge + Memory

**Goal:** Implement server-side CRUD operations for all business entities:
products, inventory, orders, knowledge, memory. These are the internal APIs
that the dashboard UI (Phase 8) and Tool Gateway (Phase 5) consume.
**PRD Reference:** Sections 7, 8.1, 15.3–15.5
**Depends On:** Phase 1, Phase 2

---

## Tasks

### 3.1 Product CRUD

- [ ] Create API routes under `src/pages/api/dashboard/products/`:
  - `index.ts` — `GET` (list, filtered by tenantId), `POST` (create).
  - `[id].ts` — `GET` (single), `PUT` (update), `DELETE` (soft delete).
- [ ] All routes: authenticate via `getAuthSession()`, filter by `tenantId`.
- [ ] Zod schemas for create/update payloads in `src/types/product.ts`.
- [ ] List endpoint supports: pagination (skip/take), search (name filter).

### 3.2 Inventory CRUD

- [ ] Create API routes under `src/pages/api/dashboard/inventory/`:
  - `index.ts` — `GET` (list by tenantId).
  - `[productId].ts` — `PUT` (update quantity).
- [ ] Inventory updates track source (MANUAL, will be EXCEL/GOOGLE_SHEETS
  from Phase 4).
- [ ] Zod schemas for update payload.

### 3.3 Order CRUD

- [ ] Create API routes under `src/pages/api/dashboard/orders/`:
  - `index.ts` — `GET` (list, filter by status).
  - `[id].ts` — `GET`, `PUT` (update status).
  - `create.ts` — `POST` (create order + order items in transaction).
- [ ] Order creation is transactional: create Order + OrderItems + update
  Inventory atomically.
- [ ] Zod schemas for order creation (items array with productId, quantity).

### 3.4 Knowledge CRUD

- [ ] Create API routes under `src/pages/api/dashboard/knowledge/`:
  - `index.ts` — `GET` (list by tenantId, filter by type).
  - `[id].ts` — `GET`, `PUT`, `DELETE`.
  - `create.ts` — `POST` (create knowledge entry).
- [ ] Knowledge types: FAQ, POLICY, BUSINESS_INFO.
- [ ] Zod schemas.

### 3.5 Memory management

- [ ] Create API routes under `src/pages/api/dashboard/memory/`:
  - `index.ts` — `GET` (list by tenantId, filter by agentId).
  - `[id].ts` — `GET`, `DELETE`.
  - `update.ts` — `PUT` (update importance flag).
- [ ] Memory is mostly read by agents; owners can view and delete.
- [ ] Zod schemas.

### 3.6 Data source management

- [ ] Create API routes under `src/pages/api/dashboard/sources/`:
  - `index.ts` — `GET` (list data sources for tenant).
  - `[id].ts` — `GET`, `DELETE` (disconnect).
  - `status.ts` — `GET` (sync status for a source).
- [ ] Tracks what sources exist and their last sync time.

### 3.7 Shared query helpers

- [ ] Create `src/lib/queries.ts`:
  - `paginate<T>(...)` — reusable skip/take pattern.
  - `requireTenant(session)` — extract and validate tenantId.
  - Common Prisma where clause builders for tenant filtering.
- [ ] Avoid duplicating tenant-filter logic across every route.

### 3.8 Contacts CRUD

- [ ] Create `src/pages/api/dashboard/contacts/`:
  - `index.ts` — `GET` (list by tenantId, search by phone/name).
  - `[id].ts` — `GET`, `PUT` (edit name/notes).
- [ ] Contacts are auto-created from inbound WhatsApp messages (Phase 7); here
  the owner/staff can list and edit them.
- [ ] Zod schemas in `src/types/contact.ts`.

### 3.9 Tags CRUD

- [ ] Create `src/pages/api/dashboard/tags/`:
  - `index.ts` — `GET` (list tags for tenant), `POST` (create tag — OWNER only).
  - `[id].ts` — `PUT` (rename), `DELETE` (remove tag — OWNER only).
- [ ] Applying tags to conversations is handled in Phase 7 (inbox APIs).
- [ ] Zod schemas in `src/types/tag.ts`.

---

## Build Gate

- [ ] `npm run build` — zero errors.
- [ ] `npm run lint` — zero errors.
- [ ] Manual smoke test: `GET /api/dashboard/products` returns seeded products.
- [ ] Manual smoke test: `POST /api/dashboard/products` creates a new product.
- [ ] Manual smoke test: `GET /api/dashboard/inventory` returns inventory.
- [ ] Manual smoke test: `POST /api/dashboard/orders` creates order + updates stock.

---

## Files Created/Modified

```
src/
├── pages/api/dashboard/
│   ├── products/
│   │   ├── index.ts
│   │   └── [id].ts
│   ├── inventory/
│   │   ├── index.ts
│   │   └── [productId].ts
│   ├── orders/
│   │   ├── index.ts
│   │   ├── [id].ts
│   │   └── create.ts
│   ├── knowledge/
│   │   ├── index.ts
│   │   ├── [id].ts
│   │   └── create.ts
│   ├── memory/
│   │   ├── index.ts
│   │   ├── [id].ts
│   │   └── update.ts
│   └── sources/
│       ├── index.ts
│       ├── [id].ts
│       └── status.ts
├── lib/
│   └── queries.ts           (shared query helpers)
├── types/
│   ├── product.ts
│   ├── inventory.ts
│   ├── order.ts
│   ├── knowledge.ts
│   └── memory.ts
```

---

## Notes

- These API routes are **dashboard-facing** (owner/admin). They are NOT the
  Tool Gateway. The Tool Gateway (Phase 5) has separate routes under
  `/api/tools/` that agents call with permission checking.
- All routes are protected by `getAuthSession()` — unauthenticated requests
  get 401.
- No soft delete pattern for MVP — hard delete with a TODO comment if needed
  later. YAGNI.
