# Software Requirements Specification (SRS)
## UMKM Agent Workspace

**Document version:** 1.0
**Date:** 2026-08-16
**Status:** Complete
**Standards:** IEEE 830-1998 (adapted)
**Companion documents:**
- `./prd-product-requirements-document.md` — Product Requirements Document (PRD)
- `./sdd-system-design-document.md` — System Design Document (SDD)
- `../plans/` — Implementation plans (11 phase files)

---

## Cross-Reference Convention

Every requirement in this document carries a unique ID and traces to the PRD section(s) it originates from.

**Format:**
- Functional requirements: `FR-<AREA>-<NNN>` (e.g., `FR-TN-001`)
- Non-functional requirements: `NFR-<TYPE>-<NNN>` (e.g., `NFR-SE-001`)
- Use cases: `UC-<NNN>`
- PRD trace: `[PRD §X.Y]` after the requirement text

**Traceability matrix** is provided in Appendix A.

---

## Table of Contents

1. Introduction
2. Overall Description
3. Functional Requirements
4. Non-Functional Requirements
5. External Interface Requirements
6. Use Cases
7. Data Requirements
8. Appendix A — Traceability Matrix

------------------------------------------------------------------------

## 1. Introduction

### 1.1 Purpose

This document specifies the software requirements for the UMKM Agent
Workspace, a self-hosted, multi-tenant AI agent platform for Indonesian
small businesses (UMKM). The platform enables UMKM to deploy AI customer
service agents on WhatsApp using their existing, fragmented business
data.

This SRS formalizes the requirements defined in the PRD into testable,
traceable statements. It is the authoritative source for "what the system
must do" and is referenced by the SDD for design traceability.

### 1.2 Scope [PRD §1, §3]

The software is a self-hosted web application that provides:

- Multi-tenant business isolation within a single installation.
- AI agent creation and deployment, starting with a Customer Service Agent.
- Business data ingestion from manual entry, Excel/CSV files, and Google Sheets.
- A Tool Gateway that mediates all agent-to-data interactions with permission
  checking, approval workflows, and audit logging.
- WhatsApp Cloud API integration as the customer-facing channel.
- A dashboard for UMKM owners to manage data, agents, capabilities, and monitor
  activity.

**Out of scope** for this SRS (and the HackFest MVP): SaaS hosting/billing,
Shopee/Tokopedia/Instagram integrations, full ERP/accounting, autonomous
refunds, advanced multi-agent collaboration, non-WhatsApp channels.
See PRD §20.

### 1.3 Definitions and Acronyms

| Term | Definition |
|------|-----------|
| UMKM | Usaha Mikro, Kecil, dan Menengah — Indonesian small/medium enterprise |
| Tenant | A single business (UMKM) within the platform; the unit of data isolation |
| Agent | An AI worker deployed by a tenant (e.g., Customer Service Agent) |
| Tool Gateway | The authorization/abstraction layer between agents and business data |
| Capability | A per-agent permission for a specific tool (read/write/approval) |
| OpenClaw | The agent runtime required by HackFest; runs agent cells per tenant |
| Cell | An isolated OpenClaw environment belonging to one tenant |
| Tool | A controlled function an agent can call (e.g., `product.read`) |
| RLS | Row-Level Security (Postgres feature for tenant isolation) |
| pgvector | PostgreSQL extension for vector similarity search on embeddings |
| Auth.js | NextAuth v4 — authentication library for Next.js |
| MVP | Minimum Viable Product (HackFest deliverable) |

### 1.4 References

1. `./prd-product-requirements-document.md` — Product Requirements Document
2. `./sdd-system-design-document.md` — System Design Document
3. `../AGENTS.md` — Project engineering rules and conventions
4. `../plans/` — Phase implementation plans
5. WhatsApp Cloud API documentation (Meta for Developers)
6. Google Sheets API documentation (googleapis)
7. OpenClaw documentation (HackFest-provided)
8. Auth.js (NextAuth) v4 documentation
9. Prisma ORM documentation
10. pgvector documentation

### 1.5 Overview

Section 2 describes the product context and user characteristics.
Section 3 lists all functional requirements with IDs and PRD traceability.
Section 4 lists non-functional requirements.
Section 5 defines external interfaces.
Section 6 provides formal use case descriptions.
Section 7 summarizes data requirements (detailed schema is in the SDD).

------------------------------------------------------------------------

## 2. Overall Description

### 2.1 Product Perspective [PRD §4]

The UMKM Agent Workspace is a standalone, self-hosted web application. It is
not a SaaS product and does not depend on a hosted backend.

The system has four layers:

1. **Dashboard** — web UI for the UMKM owner/admin.
2. **Business Context Layer** — normalizes heterogeneous data sources (manual,
   Excel/CSV, Google Sheets) into a consistent tool interface.
3. **OpenClaw Agent Runtime** — executes agent logic, sessions, tool calls.
4. **Customer Channel** — WhatsApp Cloud API for customer communication.

A single Next.js process serves both the dashboard UI and the Tool Gateway
API routes. There is no separate backend service.

### 2.2 User Characteristics [PRD §4.1, §14]

| Actor | Description | Goals |
|-------|-------------|-------|
| UMKM Owner/Admin | The business owner who deploys the platform. Configures data, knowledge, agents, permissions, channels. | Deploy an AI customer service agent using existing business data without migrating to a new system. |
| Customer | An end customer who messages the business via WhatsApp. | Get product info, prices, stock status, place orders, ask about policies. |
| Platform (system) | The automated agent runtime + Tool Gateway. | Execute customer service workflows under owner-defined permissions. |

### 2.3 Operating Environment [PRD §22A, §23A]

- **Server:** Ubuntu VPS, 4 vCPU, 4GB RAM, 20GB SSD (HackFest-provided).
- **Runtime:** Docker Compose. Containers: Next.js app, PostgreSQL 16 (pgvector),
  OpenClaw Gateway, Nginx reverse proxy.
- **TLS:** Required (WhatsApp webhook requires HTTPS). Certbot/Let's Encrypt.
- **Client (dashboard):** Modern web browser (Chrome, Firefox, Safari, Edge).
- **Client (customer):** WhatsApp mobile or web client.

### 2.4 Constraints [PRD §23A, §23B]

| ID | Constraint |
|----|-----------|
| C-001 | Next.js Pages Router only — NOT App Router. |
| C-003 | Single Next.js process serves dashboard + Tool Gateway API. |
| C-004 | PostgreSQL + Prisma + pgvector. No separate vector DB. |
| C-005 | No Redis, no external task queue. `node-cron` in-process for sync. |
| C-006 | OpenClaw is the required agent runtime (HackFest mandate). |
| C-007 | WhatsApp is pluggable: Cloud API (official) and Baileys (bring-your-own-number) are both supported; owner chooses at onboarding. Baileys carries ToS/ban risk. |
| C-008 | Auth.js credentials provider (email/password) for MVP. No OAuth. |
| C-009 | Total RAM budget: 4GB across all containers. |
| C-010 | Build window: one month (September). |
| C-011 | TypeScript strict mode. No `as` type casting (AGENTS.md §2). |
| C-012 | Every table includes `tenant_id` from day one. |

### 2.5 Assumptions and Dependencies [PRD §23A]

- OpenClaw documentation is available and the runtime integrates via HTTP.
  This is unvalidated and flagged as an open risk (see SDD §2.3).
- WhatsApp Cloud API test number is available via Meta for Developers
  without business verification for demo purposes.
- Google Sheets API access is available via standard OAuth 2.0.
- A single tenant (Toko Kopi Nusantara) is demoed, but the schema is
  multi-tenant-ready.
- AI-assisted coding (GitHub Copilot Chat) is the primary implementation
  method; stack patterns are chosen for AI-coding-friendliness.

### 2.6 Requirements Subsets / Releases

This SRS defines ONE release: the HackFest MVP. All requirements herein
are in scope for the MVP. Future expansion (Sales Agent, Inventory Agent,
additional channels) is documented in PRD §28 but is NOT specified here.

------------------------------------------------------------------------

## 3. Functional Requirements

Each requirement has a unique ID, a testable statement, and PRD traceability.
Priority: **M** = Must (MVP), **S** = Should (nice to have), **F** = Future.

### 3.1 Tenant Management (TN)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-TN-001 | M | The system SHALL allow a new tenant (business) to be created during user registration, with a name and auto-generated unique slug. | §5, §19 |
| FR-TN-002 | M | The system SHALL support multiple tenants within a single installation without requiring separate deployments. | §5 |
| FR-TN-003 | M | The system SHALL isolate all tenant data — business data, agents, channels, credentials, memory, sessions — such that no tenant can access another tenant's data. | §5, §18.1 |
| FR-TN-004 | M | Every database table SHALL include a `tenant_id` column, and all queries SHALL filter by `tenant_id` server-side. | §23A, §18.1 |
| FR-TN-005 | M | The system SHALL enforce Postgres Row-Level Security as a second isolation layer beneath application-level `tenant_id` filtering. | §23A |
| FR-TN-006 | S | The system SHALL allow a single user account to create and manage multiple tenants under the same account. | §22A.1 |

### 3.2 User Authentication (AU)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-AU-001 | M | The system SHALL provide email/password authentication via Auth.js (NextAuth) credentials provider. | §23A |
| FR-AU-002 | M | The system SHALL hash passwords using bcryptjs (or equivalent) before storage. Plaintext passwords SHALL never be stored. | §18.1 |
| FR-AU-003 | M | The system SHALL protect all `/dashboard/*` routes, redirecting unauthenticated users to `/login`. | §23B.6 |
| FR-AU-004 | M | The session token SHALL carry `userId` and `tenantId`. API routes SHALL extract these server-side via `getAuthSession()`. | §23B.6, §18.1 |
| FR-AU-005 | M | The system SHALL provide a registration page that creates both a User and a Tenant in one transaction. | §19 |
| FR-AU-006 | M | The system SHALL NOT infer owner/admin status from conversation content. Identity is bound through verified platform configuration only. | §18.1 |
| FR-AU-007 | M | The system SHALL support two roles per tenant: OWNER (full configuration control) and STAFF (inbox handling only). | §15.9, §18.1 |
| FR-AU-008 | M | The system SHALL allow an OWNER to invite staff by email; staff authenticate via the same Auth.js email/password flow and are tenant-scoped. | §15.9 |
| FR-AU-009 | M | The system SHALL enforce role-based page protection: configuration pages (agents, data, capabilities, settings) require OWNER; the inbox is open to OWNER and STAFF. | §15.9, §18.1 |

### 3.3 Agent Management (AG)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-AG-001 | M | The system SHALL allow a tenant to create one or more agents. | §6 |
| FR-AG-002 | M | The system SHALL support a Customer Service Agent type for the MVP. The architecture SHALL remain extensible for additional agent types. | §6, §19 |
| FR-AG-003 | M | Each agent SHALL have: name, type, status (DRAFT/ACTIVE/PAUSED), and instructions (text). | §15.2 |
| FR-AG-004 | M | The system SHALL allow agents to be deployed (set to ACTIVE) and paused (set to PAUSED) from the dashboard. | §15.2 |
| FR-AG-005 | M | The system SHALL create an isolated OpenClaw cell per tenant and an agent within that cell when an agent is deployed. | §5, §26 |
| FR-AG-006 | M | Within a tenant, agents SHALL have separate: workspace, agent state, session context, tool policies, and credentials. | §5, §18.1 |
| FR-AG-007 | M | Cross-agent access within a tenant SHALL be denied unless a controlled inter-agent mechanism is explicitly introduced. | §5 |
| FR-AG-008 | M | The system SHALL allow agent deletion from the dashboard (with confirmation). Only DRAFT agents SHALL be deletable. | §15.2 |

### 3.4 Business Data — Products (BDP)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-BDP-001 | M | The system SHALL allow manual creation, editing, and deletion of products with: name, description, SKU, price. | §8.1, §15.3 |
| FR-BDP-002 | M | Products SHALL be tenant-scoped. A product belongs to exactly one tenant. | §5, §23A |
| FR-BDP-003 | M | The system SHALL support searching products by name. | §14, §17 |
| FR-BDP-004 | M | The system SHALL support paginated listing of products for a tenant. | §15.3 |

### 3.5 Business Data — Inventory (BDI)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-BDI-001 | M | Each product SHALL have an associated inventory record with: quantity, source (MANUAL/EXCEL/GOOGLE_SHEETS), source reference, last updated. | §7.1, §8 |
| FR-BDI-002 | M | The system SHALL allow manual stock quantity updates. | §8.1, §15.3 |
| FR-BDI-003 | M | Inventory updates SHALL track the data source that produced the change. | §8, §13 |

### 3.6 Business Data — Orders (BDO)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-BDO-001 | M | The system SHALL support order creation with: customer name, customer phone, line items (product + quantity + unit price), and total. | §11, §14 |
| FR-BDO-002 | M | Order creation SHALL be transactional: create Order + OrderItems + update Inventory atomically. | §11 |
| FR-BDO-003 | M | Orders SHALL have a status: PENDING, CONFIRMED, CANCELLED. | §11 |
| FR-BDO-004 | M | The system SHALL allow order status updates (e.g., confirm, cancel) from the dashboard and via agent tools (when permitted). | §15.3, §17 |
| FR-BDO-005 | M | Order creation by an agent SHALL record the creating agent's ID. | §11 |

### 3.7 Knowledge Management (KN)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-KN-001 | M | The system SHALL allow creation of knowledge entries of types: FAQ, POLICY, BUSINESS_INFO. | §7.2, §15.4 |
| FR-KN-002 | M | Each knowledge entry SHALL have: title, content (text), type, and timestamps. | §7.2 |
| FR-KN-003 | M | The system SHALL allow editing and deletion of knowledge entries from the dashboard. | §15.4 |
| FR-KN-004 | M | Knowledge entries SHALL be tenant-scoped. | §5 |
| FR-KN-005 | M | The system SHALL support semantic search over knowledge using pgvector embeddings (similarity search). | §23A |
| FR-KN-006 | S | The semantic search SHALL fall back to keyword/text search when embeddings are unavailable. | §23B.4 |

### 3.8 Memory Management (ME)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-ME-001 | M | The system SHALL store agent memories with: key, value, source (CONVERSATION/MANUAL), importance (LOW/MEDIUM/HIGH), associated agent. | §7.3, §15.5 |
| FR-ME-002 | M | The system SHALL allow the owner to view, delete, and set importance of memories from the dashboard. | §15.5 |
| FR-ME-003 | M | Memory SHALL NOT override authoritative structured business data. | §7.3 |
| FR-ME-004 | M | Memories SHALL be tenant-scoped and agent-scoped. | §5 |

### 3.9 Data Ingestion — Manual (DIM)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-DIM-001 | M | The system SHALL allow manual entry of products, prices, stock, policies, and FAQs through the dashboard. | §8.1 |
| FR-DIM-002 | M | Manually entered data SHALL be marked with source = MANUAL. | §8 |

### 3.10 Data Ingestion — Excel/CSV (DIE)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-DIE-001 | M | The system SHALL accept Excel (`.xlsx`, `.xls`) and CSV (`.csv`) file uploads. | §8.2 |
| FR-DIE-002 | M | The system SHALL parse uploaded files and detect column headers. | §8.2 |
| FR-DIE-003 | M | The system SHALL infer column semantics from Indonesian and English headers (e.g., "Nama Barang" → name, "Harga" → price, "Stok" → quantity). | §8.2 |
| FR-DIE-004 | M | The system SHALL present a column mapping preview to the user before importing, with confidence indicators. | §8.2 |
| FR-DIE-005 | M | The system SHALL allow the user to correct the inferred mapping before confirming import. | §8.2 |
| FR-DIE-006 | M | On confirmation, the system SHALL upsert products and inventory based on the mapping, and record the data source. | §8.2 |
| FR-DIE-007 | M | The system SHALL record the source and last synchronization time for imported data. | §8.2 |

### 3.11 Data Ingestion — Google Sheets (DIG)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-DIG-001 | M | The system SHALL support Google Sheets connection via OAuth 2.0. | §8.3 |
| FR-DIG-002 | M | After OAuth, the system SHALL list the user's spreadsheets and allow sheet selection. | §8.3 |
| FR-DIG-003 | M | The system SHALL detect columns in the selected sheet and present a mapping preview (reusing the Excel detection logic). | §8.3 |
| FR-DIG-004 | M | The system SHALL store the connection configuration (spreadsheet ID, range, mapping, OAuth credentials) as a data source. | §8.3 |
| FR-DIG-005 | M | The system SHALL read the latest data from the sheet when the agent needs it (via tools) or when a sync is triggered. | §8.3 |
| FR-DIG-006 | M | The system SHALL perform periodic sync via `node-cron` (default: every 15 minutes) for active Google Sheets data sources. | §23A |
| FR-DIG-007 | S | The system SHALL support write-back to Google Sheets when write access is explicitly enabled. | §8.3, §12 |
| FR-DIG-008 | M | The agent SHALL NEVER receive raw spreadsheet credentials. All sheet access goes through controlled tools. | §12, §18.1 |

### 3.12 Capability and Permission Model (CP)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-CP-001 | M | The owner SHALL configure per-agent capabilities, not blanket "access to data." | §9 |
| FR-CP-002 | M | Each capability SHALL have at least: Read, Write, and Approval-required flags. | §9 |
| FR-CP-003 | M | The permission model SHALL be tool-based (e.g., `product.read`, `product.update`, `inventory.update`), not file-based. | §9 |
| FR-CP-004 | M | Agents SHALL be read-only by default. Write capabilities MUST be explicitly enabled by the owner. | §10 |
| FR-CP-005 | M | When an agent attempts an action lacking permission, the system SHALL refuse and/or escalate — never execute silently. | §10 |
| FR-CP-006 | M | When an action requires approval and the agent has write permission, the system SHALL create an approval request instead of executing. | §10, §16 |
| FR-CP-007 | M | The dashboard SHALL display capabilities as a grid grouped by category (Products, Inventory, Orders, Customer, Knowledge) with toggles. | §15.6 |
| FR-CP-008 | M | Capability changes SHALL persist and take effect immediately for the agent. | §15.6 |

### 3.13 Tool Gateway (TG)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-TG-001 | M | The Tool Gateway SHALL be the ONLY path between agents and business data. Agents SHALL NEVER access the database or external APIs directly. | §17, §23, §18.1 |
| FR-TG-002 | M | Each tool SHALL be: tenant-scoped, agent-scoped, permission-checked, audited, and input-validated. | §17 |
| FR-TG-003 | M | The system SHALL provide a tool registry containing all available tools with their definitions. | §17, Plans §5.1 |
| FR-TG-004 | M | Tool execution SHALL follow: validate input (Zod) → check permission → execute (if allowed) → audit log → return result. | §17, Plans §5.4 |
| FR-TG-005 | M | The system SHALL implement at minimum these tools: `product.read`, `product.search`, `product.update`, `inventory.read`, `inventory.update`, `order.read`, `order.create`, `order.cancel`, `customer.read`, `customer.update`, `knowledge.search`. | §17 |
| FR-TG-006 | M | Read tools SHALL be allowed by default. Write tools SHALL be denied by default with approval recommended. | §10, Plans §5.7 |
| FR-TG-007 | M | Every mutation (write) tool call SHALL be logged with: agent, action, entity, before value, after value, approval status, timestamp. | §11, §18.1 |
| FR-TG-008 | M | The Tool Gateway SHALL validate every tool input with Zod before execution. Invalid input is rejected. | §23B.6, AGENTS.md §2 |

### 3.14 WhatsApp Channel (WA)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-WA-001 | M | The system SHALL integrate with WhatsApp Cloud API (Meta) as the default customer channel. | §4.4, §23A |
| FR-WA-002 | M | The system SHALL expose a webhook endpoint that handles Meta's GET verification (hub challenge) and POST message events. | Plans §7.2 |
| FR-WA-003 | M | The webhook verify token SHALL match `WHATSAPP_VERIFY_TOKEN` from environment. | Plans §7.2 |
| FR-WA-004 | M | Incoming message payloads SHALL be Zod-validated before processing. Invalid payloads SHALL return 200 (no retry). | Plans §7.3 |
| FR-WA-005 | M | The system SHALL resolve the sender's phone to a tenant and active agent via the Channel configuration. | Plans §7.4 |
| FR-WA-006 | M | If no active agent is found, the system SHALL reply with an "agent not active" message. | Plans §7.4 |
| FR-WA-007 | M | The system SHALL send agent responses back to the customer via WhatsApp Cloud API. | §14, Plans §7.1 |
| FR-WA-008 | M | The system SHALL mark incoming messages as read after processing. | Plans §7.1 |
| FR-WA-009 | M | Only text messages SHALL be processed for the MVP. Media (images, audio, documents) is out of scope. | §20, Plans §7.3 |
| FR-WA-010 | M | The system SHALL support WhatsApp channel configuration (connect/disconnect/test) from the dashboard. | §15, Plans §7.7 |
| FR-WA-011 | M | The system SHALL support Baileys as a first-class "bring your own number" WhatsApp connection (QR/pair-code login), alongside Cloud API. Baileys operates outside WhatsApp ToS and carries ban risk; the UI SHALL warn the owner before enabling it. | §23A |
| FR-WA-012 | M | The system SHALL let the owner choose the WhatsApp connection method (Cloud API or Baileys) at channel onboarding, storing the choice as `Channel.provider`. | §4.4, §23A |
| FR-WA-013 | M | Both connection methods SHALL feed the same shared inbox, OpenClaw agent, and Tool Gateway through a common provider interface. | §4.4, §17 |

### 3.15 Approval System (AP)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-AP-001 | M | Write operations with meaningful business impact SHALL support human approval. | §16 |
| FR-AP-002 | M | For the MVP, approval SHALL be configurable for: price changes, refunds, order cancellation, large inventory changes. | §16 |
| FR-AP-003 | M | When an action requires approval, the system SHALL create an Approval record and return an approval-required payload to the agent (NOT execute). | §16, Plans §5.4 |
| FR-AP-004 | M | The dashboard SHALL display pending approvals with: agent, action, entity, proposed before/after values. | §16, §15 |
| FR-AP-005 | M | The owner SHALL approve or reject pending approvals from the dashboard. | §16 |
| FR-AP-006 | M | On approval, the system SHALL execute the original action and log the audit entry with approval status APPROVED. | §16, Plans §5.8 |
| FR-AP-007 | M | On rejection, the system SHALL log the audit entry with approval status REJECTED and NOT execute the action. | §16 |
| FR-AP-008 | M | Low-risk actions SHALL be configurable as automatic (no approval required). | §16 |

### 3.16 Audit Logging (AL)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-AL-001 | M | The system SHALL log every agent mutation (write) with: tenant, agent, action, entity type, entity ID, before value, after value, approval status, customer phone (if applicable), timestamp. | §11, §15.7 |
| FR-AL-002 | M | The dashboard SHALL display the audit log with filtering by agent, action type, and date range. | §15.7 |
| FR-AL-003 | M | Audit log entries SHALL be immutable once written. | §18.1 |
| FR-AL-004 | M | 100% of unauthorized write attempts SHALL be blocked and logged. | §22 |
| FR-AL-005 | M | 100% of successful write operations SHALL be logged. | §22 |

### 3.17 Dashboard (DB)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-DB-001 | M | The dashboard SHALL display an overview with: active agents, agent status, connected channels, data source health, recent conversations, pending approvals, recent agent actions. | §15.1 |
| FR-DB-002 | M | The dashboard SHALL provide agent management (create, configure, deploy, pause, delete). | §15.2 |
| FR-DB-003 | M | The dashboard SHALL provide data management (products, inventory, orders, imports, sources). | §15.3 |
| FR-DB-004 | M | The dashboard SHALL provide knowledge management (FAQ, policies, business info). | §15.4 |
| FR-DB-005 | M | The dashboard SHALL provide memory management (view, delete, set importance). | §15.5 |
| FR-DB-006 | M | The dashboard SHALL provide a capabilities configuration view per agent. | §15.6 |
| FR-DB-007 | M | The dashboard SHALL display the audit/activity log. | §15.7 |
| FR-DB-008 | M | The dashboard SHALL display pending approvals with approve/reject actions. | §16 |
| FR-DB-009 | M | The dashboard SHALL be accessible only to authenticated users. | §23B.6 |

### 3.18 Data Authority and Conflict Handling (CA)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-CA-001 | M | The system SHALL track for each data record: source, timestamp, last synchronization time, authority/priority, and confidence. | §13 |
| FR-CA-002 | M | The owner SHALL be able to define a source priority order (e.g., Internal > Google Sheets > Excel > Memory). | §13 |
| FR-CA-003 | M | On conflicting values, the agent SHALL prefer the authoritative (higher-priority) source. | §13 |
| FR-CA-004 | M | If the system cannot confidently determine the correct value, it SHALL ask for human clarification rather than inventing an answer. | §13 |

### 3.19 Customer Service Agent Workflows (CS)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-CS-001 | M | The agent SHALL support product inquiry: identify product, call inventory tool, return stock, answer customer. | §14 |
| FR-CS-002 | M | The agent SHALL support price inquiry: identify product, read price, respond. | §14 |
| FR-CS-003 | M | The agent SHALL support order creation: identify product, check stock, confirm price, collect order info, create order (if permitted), update stock (if permitted), send confirmation. | §14, §11 |
| FR-CS-004 | M | The agent SHALL support policy questions: search knowledge, answer based on current business policy. | §14 |
| FR-CS-005 | M | The agent SHALL escalate when it lacks information or the action exceeds its authority: answer → execute → request approval → escalate. | §14 |
| FR-CS-006 | M | The agent SHALL refuse unauthorized actions (e.g., a customer requesting a price change when price-write is disabled). | §10, §21 |
| FR-CS-007 | M | The agent SHALL respond in Bahasa Indonesia by default (configurable via instructions). | §7.4 |

### 3.20 Marketing Pages (MK)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-MK-001 | S | The system SHALL provide a public landing page at `/` with product overview and value proposition. | §20A |
| FR-MK-002 | S | The system SHALL provide a features page, how-it-works page, and getting-started page. | §20A |
| FR-MK-003 | M | Marketing pages SHALL NOT import from dashboard components, and vice versa. Clean route separation. | §20A, §23B.6 |
| FR-MK-004 | M | Marketing pages are the LOWEST priority and SHALL be built only after all MVP functionality is complete. | §20A |

### 3.21 Contacts (CT)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-CT-001 | M | The system SHALL maintain a tenant-scoped Contact record per customer phone (name, notes, phone). | §15.8 |
| FR-CT-002 | M | Contacts SHALL be auto-created from incoming WhatsApp messages and editable from the dashboard. | §15.8 |
| FR-CT-003 | M | A Contact SHALL link to its conversations, orders, and tags. | §15.8 |

### 3.22 Inbox & Conversations (IC)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-IC-001 | M | The system SHALL provide a shared inbox view listing conversations, filterable by status, assignee, and tag. | §15.8 |
| FR-IC-002 | M | The system SHALL display full message history per conversation (customer, AI agent, and human staff messages). | §15.8 |
| FR-IC-003 | M | The system SHALL allow a human (OWNER or STAFF) to reply to a conversation through the connected WhatsApp channel. | §15.8 |
| FR-IC-004 | M | Conversations SHALL have a status: OPEN, PENDING, RESOLVED, editable from the dashboard. | §15.8 |
| FR-IC-005 | M | The inbox SHALL be accessible to OWNER and STAFF roles. | §15.9 |
| FR-IC-006 | M | Staff SHALL be able to add Private Notes (internal-only messages) to a conversation; these SHALL never be sent to the customer. | §15.8 |
| FR-IC-007 | M | The conversation list SHALL support Assigned/Unassigned tab filtering, search, and a channel badge per conversation. | §15.8 |

### 3.23 Messages (MS)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-MS-001 | M | The system SHALL persist every inbound and outbound WhatsApp message (body, direction, sender type, sender ID, timestamp, WhatsApp message ID). | §15.8 |
| FR-MS-002 | M | Outbound messages SHALL be sent via the channel's configured provider (Cloud API or Baileys). | §4.4, §23A |
| FR-MS-003 | M | Cloud API outbound SHALL enforce the 24-hour customer service window for free-form text; outbound outside the window SHALL use approved templates. | §23A |
| FR-MS-004 | M | Baileys outbound SHALL have no template/window restriction (full parity). | §23A |
| FR-MS-005 | M | Private Notes SHALL be persisted as internal messages (isInternal=true) and SHALL NOT be dispatched through the WhatsApp provider. | §15.8 |

### 3.24 Tags / Labels (LB)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-LB-001 | M | The system SHALL support tenant-scoped tags (name, color) applicable to conversations. | §15.8 |
| FR-LB-002 | M | The owner/staff SHALL be able to add and remove tags on a conversation from the inbox. | §15.8 |
| FR-LB-003 | M | The inbox SHALL support filtering conversations by tag. | §15.8 |

### 3.25 Assignment (AS)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-AS-001 | M | Each conversation SHALL have an assignee that is either an AI Agent or a human User (OWNER/STAFF). | §15.8 |
| FR-AS-002 | M | The owner/staff SHALL be able to assign and reassign a conversation; each change SHALL be recorded in the audit log. | §15.8, §15.7 |
| FR-AS-003 | M | When a conversation is assigned to a human, the AI agent SHALL NOT autonomously respond on that conversation until reassigned back to the AI. | §15.8 |

### 3.26 Human/AI Handoff (HD)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-HD-001 | M | The system SHALL support handoff AI → human: a human takes over a conversation and the AI stands down. | §15.8 |
| FR-HD-002 | M | The system SHALL support handoff human → AI: reassigning a conversation back to the AI agent resumes autonomous responding. | §15.8 |
| FR-HD-003 | M | On AI escalation (PRD §14), the system SHALL allow routing the conversation to a human assignee. | §14, §15.8 |

### 3.27 Team & Staff (TS)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-TS-001 | M | A tenant SHALL support multiple human Users with roles OWNER and STAFF. | §15.9 |
| FR-TS-002 | M | An OWNER SHALL be able to invite a STAFF member by email. | §15.9 |
| FR-TS-003 | M | STAFF SHALL be restricted to inbox actions (reply, assign, tag, resolve) and SHALL NOT reconfigure agents, capabilities, or business data. | §15.9, §18.1 |
| FR-TS-004 | M | All staff actions in the inbox SHALL be tenant-scoped and audited. | §18.1 |

### 3.28 Quick Replies / Canned Responses (QR) — Stretch

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| FR-QR-001 | S | The system SHALL support tenant-scoped canned response templates (title, body, shortcut), manageable by the owner. | §15.8 |
| FR-QR-002 | S | Staff SHALL be able to insert a canned response in the inbox composer via `/<shortcut>`. | §15.8 |
| FR-QR-003 | S | Quick replies SHALL be built only after the core inbox + AI agent flow is demo-stable. | §15.8 |

------------------------------------------------------------------------

## 4. Non-Functional Requirements

### 4.1 Performance (PE)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| NFR-PE-001 | M | Dashboard API routes SHALL respond within 2 seconds for standard CRUD operations under single-tenant load. | §23A |
| NFR-PE-002 | M | Tool Gateway SHALL respond to agent tool calls within 3 seconds (including permission check + execution + audit). | §17, §23A |
| NFR-PE-003 | M | WhatsApp webhook SHALL return HTTP 200 within 5 seconds of receipt (Meta timeout). Agent processing MAY continue asynchronously. | Plans §7.2 |
| NFR-PE-004 | M | Google Sheets periodic sync SHALL run every 15 minutes via `node-cron` without blocking the main request loop. | §23A |
| NFR-PE-005 | M | Semantic knowledge search (pgvector) SHALL return results within 1 second for a single-tenant dataset. | §23A |

### 4.2 Security (SE)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| NFR-SE-001 | M | Tenant isolation SHALL be enforced at two layers: application-level `tenant_id` filtering (primary) and Postgres RLS (secondary). | §18.1, §23A |
| NFR-SE-002 | M | No tenant SHALL be able to access another tenant's data, agents, channels, credentials, memory, or sessions. | §5, §18.1 |
| NFR-SE-003 | M | The system SHALL treat all external content (customer messages, spreadsheet cells, uploaded documents) as untrusted — prompt injection defense. | §18.1 |
| NFR-SE-004 | M | The system SHALL NEVER expose raw database credentials or Google OAuth tokens to the agent/model. | §18.1, §12 |
| NFR-SE-005 | M | The system SHALL log every mutation (write operation) with before/after values and approval status. | §18.1, §11 |
| NFR-SE-006 | M | Agents SHALL be read-only by default. Write is a per-tool, per-agent permission. | §10, §18.1 |
| NFR-SE-007 | M | The system SHALL reject attempts to override identity or permissions through prompts, documents, spreadsheets, or customer messages. | §18.1 |
| NFR-SE-008 | M | Secrets SHALL NEVER be committed to the repository. `.env` is gitignored. | AGENTS.md §4 |
| NFR-SE-009 | M | Secrets SHALL NEVER leak to client bundles. All secret-bearing operations run server-side. | AGENTS.md §3, §23B.5 |
| NFR-SE-010 | M | Passwords SHALL be hashed with bcryptjs. Plaintext passwords SHALL never be stored or logged. | §18.1 |
| NFR-SE-011 | M | One OpenClaw Gateway/cell per tenant for isolation. MVP runs one tenant, but schema and architecture remain multi-tenant-ready. | §26, §18.1 |

### 4.3 Reliability and Availability (RA)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| NFR-RA-001 | M | The system SHALL run as Docker containers with `restart: unless-stopped`, recovering automatically from process crashes. | §23A, Plans §10.2 |
| NFR-RA-002 | M | Google Sheets sync failures SHALL set the data source status to ERROR and retry on the next scheduled run. | Plans §4.7 |
| NFR-RA-003 | M | WhatsApp message send failures SHALL be logged but NOT retried automatically (avoid spam). | Plans §7.6 |
| NFR-RA-004 | M | If agent processing fails, the customer SHALL receive a generic error message: "Maaf, sedang ada kendala teknis." | Plans §7.6 |

### 4.4 Maintainability (MA)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| NFR-MA-001 | M | The codebase SHALL use TypeScript strict mode. No `as` type assertions. | AGENTS.md §2, C-011 |
| NFR-MA-002 | M | Every external boundary (API routes, tool calls, webhooks, imports) SHALL validate input with Zod. | AGENTS.md §2, §23B.6 |
| NFR-MA-003 | M | File naming: kebab-case for pages/components, camelCase for lib/services. Import alias `@/*` → `src/*`. | §23B.6 |
| NFR-MA-004 | M | `components/dashboard` SHALL NOT import from `components/marketing`, and vice versa. | §23B.6 |
| NFR-MA-005 | M | All pgvector operations SHALL go through `lib/vector.ts`. No raw SQL for vectors elsewhere. | §23B.6 |
| NFR-MA-006 | M | Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`) shall be used from the first commit. | AGENTS.md §6 |
| NFR-MA-007 | M | `npm run build` and `npm run lint` SHALL pass with zero errors before any task is marked complete. | AGENTS.md Workflow |

### 4.5 Scalability (SC)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| NFR-SC-001 | M | The database schema SHALL be multi-tenant-ready from day one (every table has `tenant_id`), even though the MVP demos a single tenant. | §23A, §22 |
| NFR-SC-002 | M | The architecture SHALL support adding additional tenants without code changes (logical multi-tenancy). | §5, §22A |
| NFR-SC-003 | F | A future SaaS version MAY introduce per-tenant OpenClaw Gateway instances for stronger isolation at scale. | §22A.3 |

### 4.6 Portability (PO)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| NFR-PO-001 | M | The system SHALL deploy via Docker Compose on any supported Docker environment (VPS, cloud VM, on-premise). | §22A |
| NFR-PO-002 | M | The system SHALL run on Ubuntu with 4 vCPU / 4GB RAM / 20GB SSD. | §23A |
| NFR-PO-003 | M | Development SHALL work on Windows dev machines; deployment target is Linux VPS. | AGENTS.md Gotchas |

### 4.7 Usability (US)

| ID | Priority | Requirement | PRD Trace |
|----|----------|-------------|-----------|
| NFR-US-001 | M | A new UMKM SHALL be able to: import a product spreadsheet, add policies, configure capabilities, and deploy an agent in under 10 minutes (prepared demo tenant). | §22 |
| NFR-US-002 | M | The dashboard SHALL use Bahasa Indonesia or bilingual (ID/EN) labels appropriate for Indonesian UMKM owners. | §1, §7.4 |

------------------------------------------------------------------------

## 5. External Interface Requirements

### 5.1 WhatsApp Cloud API [PRD §4.4, §23A]

| Aspect | Specification |
|--------|--------------|
| Protocol | HTTPS |
| Base URL | `https://graph.facebook.com/v18.0` |
| Auth | Bearer token (`WHATSAPP_TOKEN`) |
| Inbound | Webhook (POST) to `/api/webhooks/whatsapp` — message events |
| Verification | Webhook (GET) with `hub.mode`, `hub.challenge`, `hub.verify_token` |
| Outbound | POST `/{phone-number-id}/messages` — send text messages |
| Mark as read | POST `/{phone-number-id}/messages` with `messaging_product: "read"` |
| Message types (MVP) | Text only |
| Rate limits | Defined by Meta; system logs 429 responses |

### 5.2 Google Sheets API [PRD §8.3, §23A]

| Aspect | Specification |
|--------|--------------|
| Protocol | HTTPS |
| Client library | `googleapis` (official Node.js SDK) |
| Auth | OAuth 2.0 (scopes: `spreadsheets` readonly + read/write when enabled) |
| OAuth flow | Authorization code flow with redirect callback |
| Operations | List spreadsheets, read range, write range (when write enabled) |
| Token storage | Stored in `DataSource.config` (DB), refreshed on expiry |
| Callback URL | `https://{domain}/api/import/sheets/callback` |

### 5.3 OpenClaw Runtime [PRD §4.3, §23A, §26]

| Aspect | Specification |
|--------|--------------|
| Protocol | HTTP (assumed — pending validation) |
| Base URL | `OPENCLAW_BASE_URL` (env) |
| Auth | API key (`OPENCLAW_API_KEY` header) |
| Operations | Create cell, create agent, configure tools, send message, configure instructions |
| Integration method | **TBD — must be validated against OpenClaw docs before backend decisions are finalized** |

### 5.4 Dashboard UI Interface [PRD §15]

| Aspect | Specification |
|--------|--------------|
| Type | Web application (Next.js Pages Router) |
| Routes | `/dashboard/*` (authenticated), `/login`, `/register` |
| Auth protection | `withAuth` HOC wrapping `getServerSideProps` |
| UI library | Tailwind CSS + shadcn/ui |
| Browser support | Chrome, Firefox, Safari, Edge (modern versions) |

------------------------------------------------------------------------

## 6. Use Cases

### UC-01: Product Inquiry [PRD §14]

| Field | Value |
|-------|-------|
| **Actor** | Customer (via WhatsApp) |
| **Precondition** | Agent is ACTIVE; product exists in tenant data |
| **Main flow** | 1. Customer sends "Kak, arabica 250g masih ada?" 2. Agent identifies product via `product.search` tool. 3. Agent calls `inventory.read` tool. 4. Agent returns stock to customer. |
| **Alternative flow** | Product not found → agent responds "Maaf, produk tidak ditemukan." |
| **Postcondition** | Conversation logged; read operations may be audited |
| **Requirements** | FR-CS-001, FR-TG-005, FR-WA-007 |

### UC-02: Order Creation [PRD §14, §11]

| Field | Value |
|-------|-------|
| **Actor** | Customer (via WhatsApp) |
| **Precondition** | Agent ACTIVE; `order.create` and `inventory.update` capabilities enabled |
| **Main flow** | 1. Customer says "Saya mau 2." 2. Agent identifies product via `product.search`. 3. Agent checks stock via `inventory.read`. 4. Agent confirms price via `product.read`. 5. Agent creates order via `order.create` (transactional: order + items + stock update). 6. Agent sends confirmation to customer. |
| **Alternative flow A** | `order.create` not permitted → agent refuses, offers to note the request. |
| **Alternative flow B** | Insufficient stock → agent informs customer. |
| **Alternative flow C** | `inventory.update` requires approval → approval created, customer told "sedang diproses." |
| **Postcondition** | Order created, inventory updated, audit log entry written |
| **Requirements** | FR-CS-003, FR-BDO-001, FR-BDO-002, FR-TG-004, FR-CP-006 |

### UC-03: Unauthorized Action Refusal (Safety Moment) [PRD §10, §21]

| Field | Value |
|-------|-------|
| **Actor** | Customer (via WhatsApp) |
| **Precondition** | Agent ACTIVE; `product.update` (price write) capability is OFF |
| **Main flow** | 1. Customer says "Ubah harga arabica jadi Rp50.000." 2. Agent checks permission for `product.update`. 3. Permission denied → agent refuses: "Maaf, saya tidak bisa mengubah harga." 4. Refusal is logged. |
| **Postcondition** | No data changed; audit log records the denied attempt |
| **Requirements** | FR-CS-006, FR-CP-004, FR-CP-005, FR-AL-004 |

### UC-04: Approval Workflow [PRD §16]

| Field | Value |
|-------|-------|
| **Actor** | Agent (initiator), UMKM Owner (approver) |
| **Precondition** | Agent has write permission but action requires approval |
| **Main flow** | 1. Agent calls write tool (e.g., `inventory.update`). 2. Permission check: allowed=true, requiresApproval=true. 3. System creates Approval record, returns approval-required payload to agent. 4. Agent tells customer "sedang menunggu persetujuan." 5. Owner sees pending approval in dashboard. 6. Owner clicks Approve. 7. System executes original action. 8. Audit log entry written with status APPROVED. |
| **Alternative flow** | Owner clicks Reject → action NOT executed, audit log entry with status REJECTED. |
| **Postcondition** | Action executed or rejected; audit trail complete |
| **Requirements** | FR-AP-001 through FR-AP-008 |

### UC-05: Excel Import [PRD §8.2]

| Field | Value |
|-------|-------|
| **Actor** | UMKM Owner |
| **Precondition** | Owner authenticated; tenant exists |
| **Main flow** | 1. Owner uploads `products.xlsx` via dashboard. 2. System parses file, detects columns. 3. System infers mapping (Nama Barang → name, Harga → price, Stok → quantity). 4. System presents mapping preview with confidence. 5. Owner confirms (or corrects) mapping. 6. System upserts products + inventory. 7. System creates DataSource record (type: EXCEL). |
| **Alternative flow** | Ambiguous columns → system asks owner to manually map. |
| **Postcondition** | Products and inventory in database; import source tracked |
| **Requirements** | FR-DIE-001 through FR-DIE-007 |

### UC-06: Google Sheets Connection [PRD §8.3]

| Field | Value |
|-------|-------|
| **Actor** | UMKM Owner |
| **Precondition** | Owner authenticated; Google Cloud project configured |
| **Main flow** | 1. Owner clicks "Connect Google Sheets." 2. System redirects to Google OAuth consent. 3. Owner authorizes. 4. Google redirects to callback with code. 5. System exchanges code for tokens, stores credentials. 6. Owner selects spreadsheet + sheet. 7. System detects columns, presents mapping. 8. Owner confirms mapping. 9. System creates DataSource (type: GOOGLE_SHEETS). 10. Periodic sync begins via node-cron. |
| **Postcondition** | Sheet connected; data syncs every 15 minutes |
| **Requirements** | FR-DIG-001 through FR-DIG-006 |

### UC-07: Agent Deployment [PRD §15.2, §26]

| Field | Value |
|-------|-------|
| **Actor** | UMKM Owner |
| **Precondition** | Agent created (DRAFT); WhatsApp channel configured |
| **Main flow** | 1. Owner configures agent instructions and capabilities. 2. Owner clicks Deploy. 3. System creates/ensures OpenClaw cell for tenant. 4. System creates OpenClaw agent in cell. 5. System registers tools from registry. 6. System configures agent instructions (system prompt). 7. System sets agent status to ACTIVE. 8. Agent begins accepting WhatsApp messages. |
| **Postcondition** | Agent ACTIVE; OpenClaw cell + agent created; tools registered |
| **Requirements** | FR-AG-004, FR-AG-005, FR-TG-003 |

### UC-08: Knowledge Semantic Search [PRD §14, §7.2]

| Field | Value |
|-------|-------|
| **Actor** | Agent (on behalf of customer) |
| **Precondition** | Knowledge entries exist with embeddings |
| **Main flow** | 1. Customer asks policy question ("Kalau barang rusak bisa ditukar?"). 2. Agent calls `knowledge.search` tool with query. 3. Tool embeds query, runs pgvector similarity search. 4. Tool returns top matching knowledge entries with similarity scores. 5. Agent answers based on returned policy content. |
| **Alternative flow** | No embeddings available → falls back to keyword search. |
| **Alternative flow** | No match above threshold → agent escalates or says "saya belum punya info itu." |
| **Postcondition** | Customer receives policy answer; conversation logged |
| **Requirements** | FR-CS-004, FR-KN-005, FR-KN-006 |

### UC-09: Human Reply via Inbox [PRD §15.8]

| Field | Value |
|-------|-------|
| **Actor** | Owner or Staff |
| **Precondition** | Conversation exists; channel connected (Cloud API or Baileys) |
| **Main flow** | 1. Staff opens the inbox, selects a conversation. 2. Reads message history. 3. Types a reply. 4. System sends the reply via the channel's provider and stores it as an outbound Message. |
| **Alternative flow** | Cloud API and outside the 24h window → system requires/uses an approved template (or blocks free-form). |
| **Postcondition** | Message sent to customer; Message record persisted; conversation updated. |
| **Requirements** | FR-IC-002, FR-IC-003, FR-MS-001..004 |

### UC-10: Assign Conversation [PRD §15.8]

| Field | Value |
|-------|-------|
| **Actor** | Owner or Staff |
| **Precondition** | Conversation exists |
| **Main flow** | 1. Staff selects a conversation. 2. Assigns it to a human staff member or to the AI agent. 3. System updates assignee and logs the change. 4. If assigned to a human, the AI stands down for that conversation. |
| **Postcondition** | Assignee updated; audit log entry written; AI behavior adjusted. |
| **Requirements** | FR-AS-001..003, FR-HD-001 |

### UC-11: Tag for Follow-Up [PRD §15.8]

| Field | Value |
|-------|-------|
| **Actor** | Owner or Staff |
| **Precondition** | Conversation exists; tags defined |
| **Main flow** | 1. Staff selects a conversation. 2. Adds the "needs follow-up" tag. 3. Later filters the inbox by that tag to find pending work. |
| **Postcondition** | Tag applied; conversation findable by tag filter. |
| **Requirements** | FR-LB-001..003 |

### UC-12: Human Takeover from AI [PRD §15.8, §14]

| Field | Value |
|-------|-------|
| **Actor** | Owner or Staff |
| **Precondition** | AI agent is handling a conversation; staff decides to intervene |
| **Main flow** | 1. Staff opens the conversation. 2. Reassigns from AI to themselves. 3. AI stands down. 4. Staff replies manually. 5. (Later) staff reassigns back to AI; autonomous responding resumes. |
| **Postcondition** | Human/AI handoff completed; audit trail intact. |
| **Requirements** | FR-HD-001..003, FR-AS-003 |

### UC-13: Onboarding — Choose WhatsApp Connection [PRD §4.4, §23A]

| Field | Value |
|-------|-------|
| **Actor** | UMKM Owner |
| **Precondition** | Tenant created; dashboard accessible |
| **Main flow** | 1. Owner opens channel settings, clicks Connect WhatsApp. 2. Chooses "Official (Cloud API)" or "Link my number (Baileys)". 3a. Cloud API: enters Meta credentials / uses test number. 3b. Baileys: scans QR with their phone. 4. System stores `Channel.provider` + config and activates the channel. |
| **Alternative flow** | Baileys chosen → system shows a ToS/ban-risk warning the owner must acknowledge. |
| **Postcondition** | Channel connected via the chosen provider; inbox and AI agent active. |
| **Requirements** | FR-WA-011, FR-WA-012, FR-WA-013 |

------------------------------------------------------------------------

## 7. Data Requirements

This section summarizes the data model at a high level. The complete schema
with field types, relations, and indexes is in the SDD §3 (Data Design).

### 7.1 Core Entities [PRD §5-7, §23A]

| Entity | Purpose | Key Fields | Tenant-Scoped |
|--------|---------|------------|---------------|
| Tenant | A single UMKM business | id, name, slug, settings | — (is the tenant) |
| User | Authenticated dashboard user | id, email, passwordHash, tenantId | Yes |
| Agent | An AI agent belonging to a tenant | id, tenantId, name, type, status, instructions | Yes |
| Channel | Customer channel connection | id, tenantId, agentId, type, config, status | Yes |
| Product | A product in tenant catalog | id, tenantId, name, sku, price, description | Yes |
| Inventory | Stock for a product | id, tenantId, productId, quantity, source | Yes |
| Order | A customer order | id, tenantId, customerName, customerPhone, status, total | Yes |
| OrderItem | Line item in an order | id, orderId, productId, quantity, unitPrice | (via Order) |
| Knowledge | FAQ/policy/business info | id, tenantId, type, title, content | Yes |
| KnowledgeEmbedding | Vector for semantic search | id, tenantId, knowledgeId, embedding (vector) | Yes |
| Memory | Agent-learned context | id, tenantId, agentId, key, value, importance | Yes |
| DataSource | Import/sheet connection | id, tenantId, type, config, status, lastSyncAt | Yes |
| AgentCapability | Per-agent tool permission | id, agentId, tool, allowed, requiresApproval | (via Agent) |
| AuditLog | Mutation audit trail | id, tenantId, agentId, action, before, after, approvalStatus | Yes |
| Approval | Pending human approval | id, tenantId, agentId, action, status, resolvedBy | Yes |
| Conversation | WhatsApp chat session tracking | id, tenantId, agentId, customerPhone, openclawSessionId, lastMessageAt | Yes |

### 7.2 Data Persistence [PRD §23A]

- All data persists in a single PostgreSQL 16 instance.
- pgvector extension provides vector storage for knowledge embeddings.
- Prisma ORM manages schema and migrations.
- No separate vector database, cache, or task queue.

### 7.3 Data Authority Metadata [PRD §13]

Each record that can originate from multiple sources carries:
- `source` — where the data came from (MANUAL, EXCEL, GOOGLE_SHEETS).
- `sourceRef` — reference to the specific file/sheet (nullable).
- `updatedAt` — last modification timestamp.
- Tenant-level source priority configured in `Tenant.settings`.

------------------------------------------------------------------------

## 8. Appendix A — Traceability Matrix

### 8.1 PRD → SRS Coverage

| PRD Section | SRS Requirements |
|-------------|------------------|
| §1 Product Summary | FR-TN-001, FR-TN-002, FR-AG-002 |
| §3 Product Vision | FR-TN-001, FR-AG-001, FR-DIE-001, FR-DIG-001, FR-CP-001, FR-WA-001 |
| §4 Core Concept (layers) | FR-TG-001, FR-WA-001, FR-DB-001 |
| §4.4 Customer Channel (pluggable) | FR-WA-001..013 |
| §5 Multi-Business Architecture | FR-TN-002, FR-TN-003, FR-TN-004, FR-AG-006, FR-AG-007 |
| §6 Agent Model | FR-AG-001, FR-AG-002, FR-AG-003 |
| §7 Business Context | FR-BDP-001, FR-BDI-001, FR-KN-001, FR-ME-001, FR-CA-001 |
| §8 Data Sources | FR-DIM-001, FR-DIE-001, FR-DIG-001 |
| §9 Capability Model | FR-CP-001, FR-CP-002, FR-CP-003, FR-CP-007 |
| §10 Read vs Write | FR-CP-004, FR-CP-005, FR-CP-006, FR-CS-006 |
| §11 Write Operations | FR-BDO-001, FR-BDO-002, FR-AL-001 |
| §12 External Data Write | FR-DIG-007, FR-DIG-008, FR-TG-001 |
| §13 Data Authority | FR-CA-001, FR-CA-002, FR-CA-003, FR-CA-004 |
| §14 Customer Service Agent | FR-CS-001 through FR-CS-007 |
| §15 Dashboard | FR-DB-001 through FR-DB-009 |
| §15.8 Conversations Inbox (CRM) | FR-IC, FR-MS, FR-LB, FR-AS, FR-HD, FR-CT, FR-QR |
| §15.9 Team & Staff | FR-TS-001..004, FR-AU-007..009 |
| §16 Approval System | FR-AP-001 through FR-AP-008 |
| §17 Agent Tool Architecture | FR-TG-001 through FR-TG-008 |
| §18 Security | NFR-SE-001 through NFR-SE-011, FR-AU-006 |
| §19 MVP Scope | All "M" priority requirements |
| §20 Out of Scope | (Documented as exclusions — not specified) |
| §20A Marketing Pages | FR-MK-001 through FR-MK-004 |
| §21 Demo | UC-01 through UC-03 |
| §22 Success Metrics | NFR-US-001, FR-AL-004, FR-AL-005 |
| §22A Self-Hosted Deployment | NFR-PO-001, NFR-PO-002, NFR-RA-001 |
| §23A Technology Stack | C-001 through C-012, NFR-MA-001 through NFR-MA-005, FR-WA-011..013 |
| §23B Project Structure | NFR-MA-003, NFR-MA-004, NFR-MA-005 |
| §24-29 (Vision/Differentiation) | (Product positioning — not functional requirements) |

### 8.2 SRS → SDD Coverage

| SRS Requirement | SDD Section |
|-----------------|-------------|
| FR-TN-001 to FR-TN-006 | SDD §3 (Data Design: Tenant model), §4.1 (Auth module) |
| FR-AU-001 to FR-AU-007 | SDD §4.1 (Auth module) |
| FR-AG-001 to FR-AG-008 | SDD §4.5 (Agent runtime integration), §3 (Agent model) |
| FR-BDP/BDI/BDO | SDD §3 (Data Design), §4.6 (Dashboard API layer) |
| FR-KN-001 to FR-KN-006 | SDD §3 (Knowledge + Embedding models), §4.3 (Vector module) |
| FR-ME-001 to FR-ME-004 | SDD §3 (Memory model) |
| FR-DIE-001 to FR-DIE-007 | SDD §4.2 (Excel service) |
| FR-DIG-001 to FR-DIG-008 | SDD §4.2 (Sheets service + scheduler) |
| FR-CP-001 to FR-CP-008 | SDD §4.4 (Permission system) |
| FR-TG-001 to FR-TG-008 | SDD §4.4 (Tool Gateway: registry, executor, audit) |
| FR-WA-001 to FR-WA-013 | SDD §4.8 (WhatsApp provider interface + Cloud API + Baileys) |
| FR-IC-001..005, FR-MS-001..004, FR-LB-001..003, FR-AS-001..003, FR-HD-001..003 | SDD §4.9 (Inbox & CRM layer), §3 (Message/Contact/Tag models) |
| FR-CT-001..003 | SDD §4.9 (Contacts), §3 (Contact model) |
| FR-TS-001..004, FR-AU-007..009 | SDD §4.1 (Auth + roles), §3 (User.role) |
| FR-AP-001 to FR-AP-008 | SDD §6.4 (Approval workflow flow) |
| FR-AL-001 to FR-AL-005 | SDD §4.4 (Audit logger), §3 (AuditLog model) |
| FR-DB-001 to FR-DB-009 | SDD §4.6 (Dashboard API layer) |
| FR-CA-001 to FR-CA-004 | SDD §6.5 (Conflict resolution flow) |
| FR-CS-001 to FR-CS-007 | SDD §6.1 (End-to-end message flow) |
| FR-MK-001 to FR-MK-004 | SDD §4.7 (Marketing layout — deferred) |
| NFR-SE-001 to NFR-SE-011 | SDD §7 (Security Design) |
| NFR-PO-001 to NFR-PO-003 | SDD §8 (Deployment Design) |
| NFR-PE-001 to NFR-PE-005 | SDD §8.6 (Resource budget) |

------------------------------------------------------------------------

**End of SRS.** The companion System Design Document (`sdd-system-design-document.md`)
provides the architectural and component-level design that satisfies these
requirements.
