# Phase 8 — Dashboard UI + CRM Inbox UI (All Pages)

**Goal:** Build the complete dashboard interface for UMKM owners and staff —
CRUD forms, data tables, AND a CRM-style shared inbox (chat panel) where humans
handle conversations alongside the AI agent. Largest phase by file count; the
inbox chat panel is the most interactive piece.
**PRD Reference:** Section 15 (Dashboard), 15.8 (Inbox/CRM), 15.9 (Team & Staff), Section 16 (Approval System)
**Depends On:** Phase 1, Phase 2, Phase 3, Phase 4, Phase 7 (inbox backend APIs)

---

## Shared UI Setup

### 8.0 Dashboard layout and navigation

- [ ] Create `src/components/dashboard/dashboard-layout.tsx`:
  - Sidebar navigation with links to all dashboard sections.
  - Top bar with tenant name and logout button.
  - Main content area.
- [ ] Create `src/components/dashboard/sidebar.tsx`:
  - Nav items: Overview, Inbox, Agents, Data, Knowledge, Memory, Contacts,
    Activity, Team, Settings. (Inbox/Contacts open to OWNER + STAFF; the rest
    require OWNER — role-based protection, PRD §15.9.)
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
  - `conversation-list.tsx` — inbox sidebar list (filter by status/assignee/tag).
  - `chat-panel.tsx` — message thread view + reply input (the CRM chat panel).
  - `message-bubble.tsx` — single message (customer/agent/human styling).
  - `tag-picker.tsx` — add/remove tags on a conversation.
  - `assignee-picker.tsx` — assign to AI agent or human user.

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

### 8.9 Inbox — CRM Chat Panel (`/dashboard/inbox`)

**PRD 15.8**

- [ ] `index.tsx` — shared inbox:
  - Left: conversation list (filter by status OPEN/PENDING/RESOLVED, assignee,
    tag; search by customer name/phone). Unread/active highlighting.
  - Right: chat panel — message thread (customer / AI agent / human staff
    bubbles), reply input, mark status, assign, tag.
  - Real-time: subscribe to `/api/dashboard/inbox/stream` (SSE) for new
    messages; fallback to polling.
- [ ] `[id].tsx` — single conversation view (deep-linkable).
- [ ] Reply: POST `/api/dashboard/inbox/[id]/messages` (human reply via the
  channel's provider — Cloud API 24h window / Baileys free).
- [ ] Assign: picker for AI agent or human staff (OWNER/STAFF).
- [ ] Tags: add/remove via `/api/dashboard/inbox/[id]/tags`.
- [ ] Status: set OPEN/PENDING/RESOLVED.
- [ ] Accessible to OWNER and STAFF (FR-IC-005).

### 8.10 Contacts (`/dashboard/contacts`)

**PRD 15.8**

- [ ] `index.tsx` — contact list (phone, name, notes, # conversations, last
  activity). Search.
- [ ] `[id].tsx` — contact detail: edit name/notes, linked conversations,
  orders, tags.

### 8.11 Team & Staff (`/dashboard/team`)

**PRD 15.9**

- [ ] `index.tsx` — staff list (OWNER only): name, email, role.
- [ ] Invite staff by email → creates a User with role STAFF in this tenant.
- [ ] Remove/change role of staff (OWNER only). STAFF who land here are
  redirected/forbidden.

---

## Build Gate

- [ ] `npm run build` — zero errors.
- [ ] `npm run lint` — zero errors.
- [ ] Visual check: every dashboard page renders without crashing.
- [ ] Navigation: all sidebar links work, correct page loads.
- [ ] Auth: unauthenticated access to any `/dashboard/*` page redirects to `/login`.
- [ ] CRUD: create a product, edit it, view it in inventory, delete it.
- [ ] Capabilities: toggle a tool permission, verify it persists.
- [ ] Inbox: open a conversation, see message history, send a human reply.
- [ ] Assignment: assign a conversation to a human → AI stands down; reassign to AI → resumes.
- [ ] Tags: add a "needs follow-up" tag, filter the inbox by it.
- [ ] Roles: STAFF can access Inbox/Contacts but are blocked from Agents/Data/Settings.
- [ ] Onboarding: choose Cloud API or Baileys; Baileys shows the ToS warning.

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
│   ├── inbox/
│   │   ├── index.tsx          (conversation list + chat panel)
│   │   └── [id].tsx           (single conversation)
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
│   ├── contacts/
│   │   ├── index.tsx          (contact list)
│   │   └── [id].tsx           (contact detail + conversations)
│   ├── team/
│   │   └── index.tsx          (staff list + invite — OWNER only)
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
