# Phase 8 — Dashboard UI (All Pages)

**Goal:** Build the complete dashboard interface for UMKM owners. This is the
largest phase by file count but lowest complexity — it's mostly CRUD forms and
data tables consuming the API routes built in Phases 2-5.
**PRD Reference:** Section 15 (Dashboard), Section 16 (Approval System)
**Depends On:** Phase 1, Phase 2, Phase 3, Phase 4

---

## Shared UI Setup

### 8.0 Dashboard layout and navigation

- [ ] Create `src/components/dashboard/dashboard-layout.tsx`:
  - Sidebar navigation with links to all dashboard sections.
  - Top bar with tenant name and logout button.
  - Main content area.
- [ ] Create `src/components/dashboard/sidebar.tsx`:
  - Nav items: Overview, Agents, Data, Knowledge, Memory, Activity, Settings.
  - Active state based on current route.
  - Collapsible on mobile (responsive).
- [ ] All dashboard pages use this layout via `_app.tsx` route check or a
  shared wrapper component.

### 8.0b Shared components

- [ ] Create reusable dashboard components in `src/components/dashboard/`:
  - `data-table.tsx` — generic table with sorting, pagination (wraps shadcn Table).
  - `stat-card.tsx` — metric display card (used in overview).
  - `empty-state.tsx` — "No data yet" placeholder.
  - `confirm-dialog.tsx` — reusable confirmation modal.
  - `loading-skeleton.tsx` — skeleton loader for data fetching.
  - `badge-status.tsx` — status badge (active/paused/error/etc.).

---

## Pages

### 8.1 Overview (`/dashboard`)

**PRD 15.1**

- [ ] Active agents count + status indicators.
- [ ] Connected channels status (WhatsApp connected/disconnected).
- [ ] Data source health cards (last sync time, error state).
- [ ] Recent conversations list (last 10).
- [ ] Pending approvals count (link to approvals page).
- [ ] Recent agent actions (last 10 audit log entries).
- [ ] All data fetched via API routes from Phases 3 and 5.

### 8.2 Agent Management (`/dashboard/agents`)

**PRD 15.2**

- [ ] `index.tsx` — agent list:
  - Table: name, type, status (badge), channel, actions (edit/deploy/pause).
  - "Create Agent" button.
- [ ] `new.tsx` — create agent form:
  - Name, type (dropdown: Customer Service for MVP), personality/description.
  - Instructions textarea (system prompt guidance).
  - Save as DRAFT.
- [ ] `[id].tsx` — agent detail + configuration:
  - Agent info card (name, type, status, created date).
  - **Capabilities tab** (PRD 15.6):
    - Grid of tools grouped by category (Product, Inventory, Order, Customer, Knowledge).
    - Each tool: Read toggle (on/off), Write toggle (on/off), Approval toggle (on/off).
    - Save capability changes → updates `AgentCapability` records.
  - **Deploy/Pause** buttons → calls Phase 6 deploy/pause APIs.
  - **Delete** button (with confirmation dialog) — only for DRAFT agents.

### 8.3 Data Management (`/dashboard/data`)

**PRD 15.3**

- [ ] `index.tsx` — data overview:
  - Tabs: Products, Inventory, Orders, Data Sources.
- [ ] `products/index.tsx` — product list:
  - Table: name, SKU, price, stock (from Inventory), actions (edit/delete).
  - Search input (name filter).
  - "Add Product" button → modal form.
- [ ] `products/[id].tsx` — product edit form.
- [ ] `inventory/index.tsx` — inventory view:
  - Table: product name, current quantity, source, last updated.
  - Manual stock adjustment button (with confirmation).
- [ ] `orders/index.tsx` — order list:
  - Table: order ID, customer, items, total, status (badge), date.
  - Filter by status.
  - Click to expand order details.
- [ ] `orders/[id].tsx` — order detail (items list, status, timestamps).
- [ ] `sources/index.tsx` — data sources:
  - List of connected sources: type (Excel/Google Sheets), name, status,
    last sync, actions (sync now / disconnect).
  - "Import Excel" button → upload modal (Phase 4).
  - "Connect Google Sheets" button → redirects to OAuth flow (Phase 4).

### 8.4 Knowledge (`/dashboard/knowledge`)

**PRD 15.4**

- [ ] `index.tsx` — knowledge list:
  - Tabs: FAQ, Policies, Business Info.
  - Table: title, type, last updated, actions (edit/delete).
  - "Add" button per type.
- [ ] `new.tsx` — create knowledge entry:
  - Type selector, title, content (textarea/rich editor if time allows,
    plain textarea for MVP).
- [ ] `[id].tsx` — edit knowledge entry.

### 8.5 Memory (`/dashboard/memory`)

**PRD 15.5**

- [ ] `index.tsx` — memory list:
  - Table: key, value (truncated), source, importance (badge), date, actions.
  - Filter by agent.
  - Delete button (with confirmation).
  - Read-only — owners view and delete, not edit.

### 8.6 Activity / Audit Log (`/dashboard/activity`)

**PRD 15.7**

- [ ] `index.tsx` — audit log table:
  - Columns: timestamp, agent, action, entity, before/after values,
    approval status, customer phone.
  - Filter by: agent, action type, date range.
  - Pagination.
  - Expandable rows for before/after details.

### 8.7 Approvals (`/dashboard/approvals`)

**PRD 16**

- [ ] `index.tsx` — pending approvals list:
  - Cards per approval: agent name, action, entity, proposed before → after.
  - Approve / Reject buttons per card.
  - Approved/rejected tabs with history.

### 8.8 Settings (`/dashboard/settings`)

- [ ] `index.tsx` — settings page:
  - **Channels section:** connect/disconnect WhatsApp, show connection status.
  - **Source priority section:** drag-and-drop or numbered list to set data
    authority order (PRD 13).
  - **Account section:** change email/password (stretch — nice to have).

---

## Build Gate

- [ ] `npm run build` — zero errors.
- [ ] `npm run lint` — zero errors.
- [ ] Visual check: every dashboard page renders without crashing.
- [ ] Navigation: all sidebar links work, correct page loads.
- [ ] Auth: unauthenticated access to any `/dashboard/*` page redirects to `/login`.
- [ ] CRUD: create a product, edit it, view it in inventory, delete it.
- [ ] Capabilities: toggle a tool permission, verify it persists.

---

## Files Created/Modified

```
src/
├── components/dashboard/
│   ├── dashboard-layout.tsx
│   ├── sidebar.tsx
│   ├── data-table.tsx
│   ├── stat-card.tsx
│   ├── empty-state.tsx
│   ├── confirm-dialog.tsx
│   ├── loading-skeleton.tsx
│   └── badge-status.tsx
├── pages/dashboard/
│   ├── index.tsx              (overview)
│   ├── agents/
│   │   ├── index.tsx          (list)
│   │   ├── new.tsx            (create)
│   │   └── [id].tsx           (detail + capabilities)
│   ├── data/
│   │   ├── index.tsx          (overview with tabs)
│   │   ├── products/
│   │   │   ├── index.tsx      (list)
│   │   │   └── [id].tsx       (edit)
│   │   ├── inventory/
│   │   │   └── index.tsx
│   │   ├── orders/
│   │   │   ├── index.tsx
│   │   │   └── [id].tsx
│   │   └── sources/
│   │       └── index.tsx
│   ├── knowledge/
│   │   ├── index.tsx
│   │   ├── new.tsx
│   │   └── [id].tsx
│   ├── memory/
│   │   └── index.tsx
│   ├── activity/
│   │   └── index.tsx
│   ├── approvals/
│   │   └── index.tsx
│   └── settings/
│       └── index.tsx
```

---

## Notes

- This is the largest phase by page count (~18 pages). Keep each page simple —
  standard CRUD patterns, no custom animations, no complex state management.
- Use `getServerSideProps` to fetch data server-side (not client-side SWR for MVP).
  It's simpler, works with auth, and keeps the bundle small.
- shadcn/ui components cover 90% of what we need. Don't build custom UI primitives.
- The dashboard does NOT need to be beautiful for HackFest. It needs to be
  functional and demonstrate the platform's capabilities.
