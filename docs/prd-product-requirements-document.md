# PRD: Self-Hosted UMKM AI Agent Platform

**Working title:** CSQ\
**HackFest category:** Customer Service\
**Primary agent:** AI Customer Service Agent\
**Runtime:** OpenClaw\
**Stack:** Next.js (Pages Router) + PostgreSQL/Prisma/pgvector + WhatsApp Cloud API\
**Document status:** HackFest MVP PRD\
**Date:** 2026-08-16

------------------------------------------------------------------------

## 1. Product Summary

Build a multi-tenant platform that allows Indonesian UMKM to deploy AI
agents without forcing them to migrate their existing business data into
a new system.

Each UMKM gets an isolated OpenClaw environment ("cell") and can create
one or more agents. The first agent is a Customer Service Agent that can
operate through WhatsApp and use the business's own data, knowledge,
rules, and memory.

The deployment should support both:

-   **Internal data:** information entered or maintained directly in the
    platform.
-   **External data:** Excel/CSV files and connected spreadsheets such
    as Google Sheets.

The core product value is:

> **Teach the agent how your business works, connect the data you
> already have, choose what the agent is allowed to do, and deploy it to
> your customers.**

------------------------------------------------------------------------

## 2. Problem

Many UMKM already communicate with customers through WhatsApp, but their
business information is fragmented.

Examples:

-   Product information is entered manually.
-   Stock is maintained in Excel.
-   Prices are stored in Google Sheets.
-   FAQs and policies exist as documents.
-   Some information exists only in WhatsApp conversations.
-   Some businesses have no formal database at all.

This creates a major barrier for AI adoption.

A generic chatbot does not know:

-   Which products exist.
-   Current prices.
-   Current stock.
-   Shipping rules.
-   Return policies.
-   Which actions it is allowed to perform.
-   Which information is authoritative when sources conflict.

The business should not have to change its entire workflow just to use
an AI agent.

------------------------------------------------------------------------

## 3. Product Vision

Create a platform where an UMKM can deploy an AI employee using the
business data and workflows it already has.

The platform should make the following possible:

1.  Connect business data.
2.  Teach the agent business knowledge.
3.  Define agent behavior and permissions.
4.  Deploy the agent to a customer-facing channel.
5.  Allow the agent to read business data.
6.  Optionally allow the agent to perform controlled write operations.
7.  Keep tenant, agent, credential, memory, and data boundaries
    isolated.

------------------------------------------------------------------------

## 4. Core Product Concept

The system has four major layers.

``` text
UMKM Dashboard
      |
      v
Business Context Layer
      |
      v
OpenClaw Agent Runtime
      |
      v
Customer Channel
```

### 4.1 Dashboard

Used by the UMKM owner/admin to:

-   Manage business information.
-   Add/import data.
-   Connect external data sources.
-   Add knowledge and documentation.
-   Define agent instructions.
-   Configure agent capabilities.
-   Create and manage agents.
-   Connect customer channels.
-   Deploy, pause, and monitor agents.

### 4.2 Business Context Layer

Normalizes different business data sources into a consistent interface
for agents.

Example:

``` text
Excel
Google Sheets
Manual input
CSV
Documents
        |
        v
Business Context Layer
        |
        +-- get_product()
        +-- get_stock()
        +-- get_order()
        +-- search_knowledge()
        +-- update_stock()
        +-- create_order()
```

The agent should not need to know whether the source is Excel, Google
Sheets, or an internal database.

### 4.3 OpenClaw Runtime

OpenClaw is responsible for:

-   Agent execution.
-   Conversations.
-   Sessions.
-   Skills.
-   Tool calling.
-   Agent-specific workspace/state.
-   Channel integrations.
-   Agent-level tool restrictions.

OpenClaw supports per-agent workspaces and tool policies, including
allowing or denying read/write capabilities. It also supports separate
Gateway instances for stronger tenant isolation.

### 4.4 Customer Channel

HackFest MVP:

-   WhatsApp — supported via two pluggable connection methods, chosen by
    the owner at onboarding (see §23A):
    -   **Cloud API (official):** Meta WhatsApp Business API. ToS-safe;
        free test number for development; free-form replies limited to the
        24-hour customer service window, templates for proactive outbound.
    -   **Baileys (bring your own number):** the owner links their existing
        WhatsApp number by scanning a QR code (like WhatsApp Web). Full
        parity, no templates, no per-message fees; carries WhatsApp
        ToS/ban risk.
-   Both methods feed the same shared inbox (§15.8), the same OpenClaw
    agent, and the same Tool Gateway.

Future:

-   Website chat.
-   Instagram.
-   Telegram.
-   Messenger.
-   Other business channels.

------------------------------------------------------------------------

# 5. Multi-Business Architecture

Business isolation is a fundamental requirement.

The MVP is self-hosted, but a single installation can contain multiple businesses. A user does not need a separate deployment for each business. Each business is a logical tenant/data boundary inside the installation.

Each tenant receives its own isolated OpenClaw Gateway/cell.

``` text
Platform
|
+-- Business A
|   |
|   +-- OpenClaw Cell A
|       |
|       +-- Customer Service Agent
|       +-- Sales Agent
|       +-- Inventory Agent
|
+-- Business B
|   |
|   +-- OpenClaw Cell B
|       |
|       +-- Customer Service Agent
|       +-- Sales Agent
|
+-- Business C
    |
    +-- OpenClaw Cell C
        |
        +-- Customer Service Agent
```

### Isolation requirements

Business A must never be able to access:

-   Business B's business data.
-   Business B's agent workspace.
-   Business B's agent memory.
-   Business B's sessions.
-   Business B's credentials.
-   Business B's WhatsApp account.
-   Business B's tools.
-   Business B's documents.

Within a tenant, agents should also have separate:

-   Workspace.
-   Agent state.
-   Session store.
-   Credentials.
-   Tool permissions.

Cross-agent access should be explicitly denied unless the platform later
introduces a controlled inter-agent mechanism.

------------------------------------------------------------------------

# 6. Agent Model

A tenant can create multiple specialized agents.

Example:

``` text
Toko Budi
|
+-- Customer Service Agent
+-- Sales Agent
+-- Inventory Agent
+-- Admin Agent
```

The Customer Service Agent is the first fully-implemented agent type. A
tenant can create multiple agents from day one, and additional
specialized types (Sales, Inventory, Admin, Operations) can be added
over time — the architecture supports this from the start.

------------------------------------------------------------------------

# 7. Business Context

Every agent receives controlled access to a tenant's business context.

Business context consists of:

## 7.1 Structured Data

Examples:

-   Products.
-   Prices.
-   Stock.
-   Orders.
-   Customers.
-   Promotions.
-   Shipping information.

## 7.2 Knowledge

Examples:

-   FAQ.
-   Return policy.
-   Shipping policy.
-   Warranty policy.
-   Business information.
-   Product documentation.

## 7.3 Memory

Memory represents information learned from interactions or explicitly
saved by the business.

Examples:

-   Customer preferences.
-   Previous support cases.
-   Important customer context.
-   Business-specific learned facts.

Memory must not replace authoritative structured business data.

## 7.4 Instructions and Rules

Examples:

-   Always respond in Bahasa Indonesia.
-   Address customers as "Kak".
-   Never promise stock without checking current inventory.
-   Escalate refunds above Rp500,000.
-   Never provide an unauthorized discount.
-   Ask for human approval before changing product prices.

------------------------------------------------------------------------

# 8. Data Sources

The MVP should support three primary ingestion methods.

## 8.1 Manual Data

Owner can manually create or edit:

-   Products.
-   Prices.
-   Stock.
-   Policies.
-   FAQs.

## 8.2 Excel / CSV

Owner uploads a spreadsheet.

The system:

1.  Reads the file.
2.  Detects columns.
3.  Infers their meaning.
4.  Shows a mapping preview.
5.  Asks for confirmation if ambiguous.
6.  Imports the data.
7.  Records the source and last synchronization time.

Example:

``` text
Nama Barang -> product.name
Harga Jual  -> product.price
Sisa        -> inventory.quantity
```

## 8.3 Google Sheets

Owner connects a spreadsheet.

The system:

1.  Authenticates the account.
2.  Lets the owner select a spreadsheet.
3.  Detects sheets and columns.
4.  Maps the data.
5.  Stores the connection configuration.
6.  Reads the latest data when the agent needs it.
7.  Optionally writes back when write access is explicitly enabled.

------------------------------------------------------------------------

# 9. Agent Capability Model

This is a critical product feature.

The owner should not simply choose "AI has access to data."

The owner should configure **what the agent is allowed to do**.

Each capability has at least:

-   Read.
-   Write.
-   Approval required.

Example:

  Capability        Read   Write      Approval
  --------------- ------ ------- -------------
  Products           Yes     Yes      Optional
  Price              Yes     Yes   Recommended
  Stock              Yes     Yes   Recommended
  Orders             Yes     Yes   Recommended
  Customer data      Yes     Yes   Recommended
  FAQ                Yes     Yes      Optional
  Policies           Yes     Yes   Recommended

The final permission model should be tool-based rather than file-based.

For example:

``` text
product.read
product.update

inventory.read
inventory.update

order.read
order.create
order.cancel

customer.read
customer.update
```

This is safer than giving the agent unrestricted access to a
spreadsheet.

------------------------------------------------------------------------

# 10. Read vs Write Access

## Recommended default

**Agents should be read-only by default.**

This is important for trust and safety.

For example, after connecting Google Sheets:

``` text
Google Sheets
|
+-- Read product data       ON
+-- Read stock              ON
+-- Update stock            OFF
+-- Update price            OFF
+-- Create order            OFF
```

The owner can explicitly enable write capabilities.

## Why?

A customer message should not automatically give the agent unrestricted
permission to modify business data.

Example:

Customer:

> "Kak, stoknya ubah jadi 100 ya."

The agent should not update inventory simply because a customer asked.

Instead:

``` text
Customer request
      |
      v
Agent
      |
      v
Does this action have permission?
      |
   NO -> refuse / escalate
   YES
      |
      v
Does it require approval?
      |
   YES -> ask owner
   NO  -> execute
```

------------------------------------------------------------------------

# 11. Write Operations

The agent should be capable of updating business data when the
capability is explicitly enabled.

Example:

Customer purchases 2 units.

Agent:

1.  Checks stock.
2.  Creates order.
3.  Updates inventory.
4.  Records the transaction.
5.  Confirms the customer.

``` text
Stock before: 10

Order: 2 units

Stock after: 8
```

The system should record:

``` text
Action:
inventory.update

Agent:
Customer Service Agent

Business:
Toko Budi

Source:
Order #1234

Before:
10

After:
8

Timestamp:
...

Approval:
Not required
```

This creates an auditable action trail.

------------------------------------------------------------------------

# 12. External Data Write Strategy

For external sources such as Google Sheets, the platform should treat
write access as a separate capability.

Example:

``` text
Google Sheets
|
+-- Read Products       ✓
+-- Read Stock          ✓
+-- Write Stock         ✓
+-- Write Price         ✕
```

The agent should never receive raw spreadsheet credentials.

Instead, your platform exposes controlled tools:

``` text
get_stock(product_id)
update_stock(product_id, quantity)
get_product(product_id)
update_product_price(product_id, price)
```

The backend validates the request and performs the actual spreadsheet
operation.

This creates an authorization layer between the agent and the external
system.

------------------------------------------------------------------------

# 13. Data Authority and Conflict Handling

Different sources may contain conflicting information.

Example:

``` text
Internal database:
Stock = 5
Updated 3 days ago

Google Sheets:
Stock = 3
Updated 10 minutes ago
```

The platform should maintain:

-   Source.
-   Timestamp.
-   Last synchronization.
-   Authority/priority.
-   Confidence.

The owner can define a source priority:

``` text
1. Internal inventory
2. Google Sheets
3. Imported Excel
4. Agent memory
```

The agent should prefer authoritative sources over memories or stale
documents.

If the system cannot confidently determine the correct value, it should
ask for human clarification rather than inventing an answer.

------------------------------------------------------------------------

# 14. Customer Service Agent

The MVP agent should support these workflows.

## Product inquiry

Customer:

> "Kak, kopi arabica 250g masih ada?"

Agent:

1.  Identify product.
2.  Call inventory tool.
3.  Return current stock.
4.  Answer customer.

## Price inquiry

Customer:

> "Berapa harganya?"

Agent:

1.  Identify product.
2.  Read current price.
3.  Respond.

## Order creation

Customer:

> "Saya mau 2."

Agent:

1.  Identify product.
2.  Check stock.
3.  Confirm price.
4.  Collect required order information.
5.  Create order if permitted.
6.  Update stock if permitted.
7.  Send confirmation.

## Policy question

Customer:

> "Kalau barang rusak bisa ditukar?"

Agent:

1.  Search return policy.
2.  Answer based on current business policy.

## Escalation

If the agent lacks sufficient information or the action exceeds its
authority:

``` text
Agent
  |
  +-- Can answer -> answer
  |
  +-- Can execute -> execute
  |
  +-- Requires approval -> ask owner
  |
  +-- Unknown/high-risk -> escalate
```

------------------------------------------------------------------------

# 15. Dashboard

## 15.1 Overview

Show:

-   Active agents.
-   Agent status.
-   Connected channels.
-   Data source health.
-   Recent conversations.
-   Pending approvals.
-   Recent agent actions.

## 15.2 Agent Management

Owner can:

-   Create agent.
-   Select agent type.
-   Configure name/personality.
-   Configure instructions.
-   Configure capabilities.
-   Configure tools.
-   Connect channels.
-   Deploy.
-   Pause.
-   Delete.

## 15.3 Data Management

Owner can:

-   Add products.
-   Edit prices.
-   Edit stock.
-   Import Excel/CSV.
-   Connect Google Sheets.
-   View source status.
-   View synchronization history.

## 15.4 Knowledge

Owner can:

-   Add FAQ.
-   Add policies.
-   Upload documents.
-   Add business information.
-   Edit knowledge.

## 15.5 Memory

Owner can:

-   View memories.
-   Remove memories.
-   Mark memories as important.
-   Inspect memory source.

## 15.6 Capabilities

Owner can configure:

``` text
Customer Service Agent

Products
  Read  ✓
  Write ✕

Inventory
  Read  ✓
  Write  ✓
  Approval Required ✓

Orders
  Read  ✓
  Create ✓
  Cancel ✕

Pricing
  Read  ✓
  Update ✕
```

## 15.7 Activity / Audit Log

Show:

-   Agent.
-   Action.
-   Data source.
-   Before value.
-   After value.
-   Customer/conversation.
-   Approval status.
-   Timestamp.

## 15.8 Conversations Inbox (CRM)

The dashboard includes a shared inbox — a CRM-style chat workspace
(similar to WhatsApp Web / Qontak / CekAjaAI) where the owner and staff
handle customer conversations alongside the AI agent.

-   **Chat panel:** live message history per conversation (customer,
    AI agent, and human staff messages), with the ability for a human to
    reply directly through the connected WhatsApp channel.
-   **Assignment:** each conversation can be assigned to the AI agent
    (autonomous) or to a human staff member. Reassignment is supported;
    changes are audited.
-   **Tags / labels:** conversations can be tagged (e.g., "needs
    follow-up", "VIP", "refund") and filtered by tag.
-   **Status:** OPEN / PENDING / RESOLVED, with filtering.
-   **Human/AI handoff:** a conversation can flow AI → human → AI. When a
    human is assigned, the AI agent stands down for that conversation
    until reassigned back.
-   **Private notes (MVP):** staff can add internal notes to a
    conversation — visible to team members only, never sent to the
    customer (like Cekat.AI's Private Note feature).
-   **Quick replies / canned responses (stretch):** tenant-scoped
    templates (title, body, `/shortcut`) insertable from the composer.
    Built only after the core inbox is stable.
-   **Contacts:** a tenant-scoped contact record per customer phone
    (name, notes), linked to conversations, orders, and tags.
-   **Works with both WhatsApp connection methods** (Cloud API and
    Baileys). Human replies respect the connection's constraints (Cloud
    API: 24-hour window + templates for outbound; Baileys: free reply
    anytime).

**Layout reference:** conversation list on the left (Assigned/Unassigned
tabs, channel badges, search, filters) + chat panel on the right with a
composer toolbar (Reply, Private Note, Template). See
`docs/assets/reference-cekatai-inbox.png` (Cekat.AI-style layout).

## 15.9 Team & Staff Management

-   A tenant can have multiple human users with roles: **OWNER** (full
    control: configure agent, data, capabilities, invite staff, manage
    channels) and **STAFF** (handle inbox conversations: reply, assign,
    tag, resolve; cannot reconfigure the AI agent or business data).
-   The owner invites staff by email; staff authenticate with the same
    Auth.js email/password flow.
-   Staff are tenant-scoped and cannot access other tenants' data.
-   Role-based page protection: configuration pages (agents, data,
    capabilities, settings) require OWNER; the inbox is open to OWNER
    and STAFF.

------------------------------------------------------------------------

# 16. Approval System

Write operations with meaningful business impact should support human
approval.

Example:

``` text
Agent wants to:

Update stock
Product: Kopi Arabica
10 -> 8
Reason: Order #1234

[Approve] [Reject]
```

For the MVP, approval can be implemented for:

-   Price changes.
-   Refunds.
-   Order cancellation.
-   Large inventory changes.

Low-risk actions can be configured as automatic.

------------------------------------------------------------------------

# 17. Agent Tool Architecture

The agent should interact with controlled tools rather than directly
accessing tenant databases or external credentials.

Example tool interface:

``` text
get_product()
search_products()
get_stock()
update_stock()
get_order()
create_order()
search_customer()
search_knowledge()
create_support_ticket()
```

Each tool is:

-   Tenant-scoped.
-   Agent-scoped.
-   Permission-checked.
-   Audited.
-   Validated.

The tool layer is responsible for determining whether the operation can
be executed.

------------------------------------------------------------------------

# 18. Security Requirements


## 18.1 Authorization Requirements

- Never infer owner/admin status from conversation content.
- Bind WhatsApp identities to a tenant and role through verified platform configuration.
- Resolve authorization before executing sensitive tools.
- Enforce customer-specific data scope server-side.
- Treat LLM reasoning as intent interpretation, not permission granting.
- Reject attempts to override identity or permissions through prompts, uploaded documents, spreadsheets, or customer messages.
- Enforce role-based access within a tenant: OWNER has full configuration control; STAFF may handle inbox conversations (reply, assign, tag, resolve) but cannot reconfigure agents, capabilities, or business data.



### Tenant isolation

-   One OpenClaw Gateway/cell per tenant.
-   Separate tenant credentials.
-   Separate tenant data.
-   Separate channel credentials.
-   Separate workspaces.
-   Separate sessions.

### Agent isolation

-   Separate OpenClaw agent workspace.
-   Separate agent state.
-   Separate session context.
-   Separate tool policies.
-   Separate credentials where applicable.

### Tool security

-   Deny write by default.
-   Explicitly grant write capabilities.
-   Validate every tool call server-side.
-   Never expose raw database credentials to the model.
-   Never expose raw Google OAuth tokens to the model.
-   Log every mutation.

### Prompt injection defense

External content should be treated as untrusted.

A customer message, spreadsheet cell, uploaded document, or web page
must not be able to redefine the agent's system-level permissions.

------------------------------------------------------------------------

# 19. HackFest MVP Scope

Focus on one excellent end-to-end experience.

## Must Have

### Platform

-   Tenant registration.
-   Tenant dashboard.
-   Tenant-isolated OpenClaw cell.
-   Agent creation.
-   Agent deployment.

### Data

-   Manual product data.
-   Excel/CSV import.
-   Google Sheets read integration.
-   Product/price/stock model.

### Knowledge

-   FAQ.
-   Shipping policy.
-   Return policy.
-   Business instructions.

### Agent

-   Customer Service Agent.
-   WhatsApp integration.
-   Product lookup.
-   Stock lookup.
-   Price lookup.
-   Knowledge retrieval.
-   Basic order creation.
-   Controlled stock update.

### Capabilities

-   Read-only by default.
-   Per-tool write permissions.
-   Approval requirement for selected actions.

### Observability

-   Conversation history.
-   Agent actions.
-   Audit log.
-   Data source status.

------------------------------------------------------------------------

# 20. Explicitly Out of Scope for MVP


### Hosting / SaaS

The following are also out of scope:

- Centralized SaaS hosting.
- Subscription/billing.
- Hosted tenant provisioning.
- Customer-facing SaaS account management across hosted infrastructure.
- Fleet management across many customer deployments.

Logical multi-business support inside one self-hosted installation is **in scope**.



Do not attempt to build all of these for the competition:

-   Shopee integration.
-   Tokopedia integration.
-   Instagram integration.
-   Multiple POS integrations.
-   Full accounting.
-   Complex ERP.
-   Automatic financial reconciliation.
-   Fully autonomous refunds.
-   Advanced multi-agent collaboration.
-   Dozens of data formats.
-   Arbitrary database connectors.

The goal is to prove the architecture and agent workflow, not to build a
complete ERP.

------------------------------------------------------------------------

# 20A. Marketing Pages — Deferred to Final Phase

Public-facing marketing website for the UMKM Agent Workspace product itself.

These pages are **not** the UMKM dashboard. They are the product's public
website — what a visitor sees before signing up or self-hosting.

## Pages

-   **Landing page:** product overview, value proposition, core loop
    visualization, and the key differentiation (your data stays yours,
    agent works under your permissions).
-   **Features:** agent capabilities, supported data sources, permission
    model, safety guarantees, multi-tenant isolation.
-   **How it works:** step-by-step setup flow (import data → configure agent
    → set permissions → deploy to WhatsApp → agent serves customers).
-   **Getting started:** self-hosted installation guide, requirements,
    Docker Compose quickstart.

## Constraints

-   Same Next.js app, same stack (Pages Router, Tailwind, shadcn/ui).
    No separate frontend build or framework.
-   **Lowest priority.** Built only after all MVP functionality is complete,
    tested, and the demo flows are verified. Nothing here blocks the HackFest
    deliverable.
-   Must not interfere with or complicate the dashboard and API route
    structure. Marketing routes live at the top level; dashboard routes live
    under `/dashboard/` or similar — clean separation from day one.
-   Static or minimally dynamic. No backend data required for marketing
    content. Product copy, screenshots, and diagrams are sufficient.

------------------------------------------------------------------------

# 21. Recommended HackFest Demo

The demo should show a business with messy existing data.

### Step 1: Create UMKM

``` text
Toko Kopi Nusantara
```

### Step 2: Import Excel

Upload:

``` text
products.xlsx
```

Containing:

``` text
Product | Price | Stock
Arabica 250g | 85000 | 12
Robusta 250g | 65000 | 8
```

### Step 3: Connect Google Sheets

Connect a sheet containing updated inventory.

The platform detects and maps:

``` text
Nama Produk -> Product
Stok -> Inventory
```

### Step 4: Add knowledge

Upload:

``` text
return-policy.pdf
shipping-policy.pdf
```

### Step 5: Configure agent

``` text
Customer Service Agent

Read:
✓ Products
✓ Prices
✓ Stock
✓ Policies

Write:
✓ Create Order
✓ Update Stock

Approval:
✓ Refund
✓ Price Change
```

### Step 6: Deploy WhatsApp

Agent becomes active.

### Step 7: Customer interaction

Customer:

> "Kak, arabica 250g masih ada?"

Agent checks live business data.

> "Masih ada 12 pcs, Kak. Harganya Rp85.000."

Customer:

> "Saya mau 2."

Agent:

1.  Creates order.
2.  Updates stock from 12 to 10.
3.  Logs the mutation.
4.  Confirms order.

### Step 8: Demonstrate safety

Customer:

> "Ubah harga arabica jadi Rp50.000."

Agent refuses to perform the change because the agent lacks the
price-write capability.

This single moment demonstrates that the agent is not merely a chatbot;
it is an **AI worker operating under business-defined permissions**.

------------------------------------------------------------------------

# 22. Success Metrics

For the HackFest MVP:

### Agent effectiveness

-   = 90% correct answers on seeded business questions.

-   = 95% correct product/stock lookup.

-   100% of unauthorized write operations blocked.

-   100% of successful write operations logged.

### Setup

A new UMKM should be able to:

-   Import a product spreadsheet.
-   Add business policies.
-   Configure capabilities.
-   Deploy an agent.

Target setup time:

**\< 10 minutes for a prepared demo tenant.**

### Agent autonomy

The agent should be able to complete an order workflow without human
intervention when all required permissions are enabled.

------------------------------------------------------------------------

# 22A. Self-Hosted Deployment Model

The HackFest product is **not designed as a SaaS product**.

The intended model is:

```text
UMKM owns/runs a server
        |
        v
Install the application
        |
        +-- Dashboard
        +-- Business database
        +-- Data connectors
        +-- OpenClaw Gateway
        +-- Agent workspaces
        +-- Channel credentials
```

The UMKM admin can deploy the system to:

- VPS.
- Cloud VM.
- On-premise server.
- A supported Docker environment.

The user remains responsible for the server, connected accounts, and business data. A single user can create and manage multiple businesses without deploying the application again.

## 22A.1 Installation

The MVP should aim for a simple installation flow, ideally:

```text
1. Provision server
2. Install application once
3. Configure environment
4. Open dashboard
5. Create user account
6. Create Business A
7. Configure OpenClaw
8. Create agents for Business A
9. Connect Business A data sources
10. Connect Business A WhatsApp
11. Deploy agents
12. Optionally create Business B under the same user account
```

## 22A.2 Why Self-Hosted

Self-hosting is intentional for the HackFest version because it:

- Avoids solving commercial SaaS multi-tenancy.
- Keeps business data under the UMKM's control.
- Makes deployment architecture easier to demonstrate.
- Reduces the amount of infrastructure needed for the MVP.
- Fits the concept of an AI employee that operates inside the business's own environment.

## 22A.3 Future Hosted Version

A future SaaS version may introduce:

```text
Hosted Platform
|
+-- Business A -> isolated OpenClaw cell
+-- Business B -> isolated OpenClaw cell
+-- Business C -> isolated OpenClaw cell
```

However, this is explicitly out of scope for the HackFest MVP.


# 23. Technical Architecture

``` text
                        Web Dashboard
                              |
                              v
                       Platform API
                              |
          +-------------------+-------------------+
          |                                       |
          v                                       v
   Tenant/Data Layer                       Agent Control Plane
          |                                       |
    +-----+------+                         +------+------+
    |            |                         |             |
 Internal DB   Connectors              OpenClaw A    OpenClaw B
    |            |                         |             |
    |        +---+---+                     Agents       Agents
    |        |       |                       |             |
    |     Excel   Sheets                     |             |
    |                                        |             |
    +-------------------+--------------------+-------------+
                        |
                   Tool Gateway
                        |
             +----------+----------+
             |          |          |
          Product     Stock      Order
           Tools      Tools      Tools
             |          |          |
             +----------+----------+
                        |
                  Business Data
```

The Tool Gateway is the authorization and abstraction layer between
OpenClaw and business data.

------------------------------------------------------------------------

# 23A. Technology Stack

## Guiding Constraints

-   Single VPS provided by HackFest (CloudBaik): 4 vCPU, 4GB RAM, 20GB
    SSD.
-   One-month build window (September).
-   The schema and runtime are multi-tenant by construction: each tenant
    gets an isolated OpenClaw cell (see sections 5 and 26). There is no
    single-tenant mode and no shared-cell fallback.
-   Prefer stack patterns that are well represented in AI coding
    assistant training data, since most implementation will be
    AI-assisted (GitHub Copilot Chat).

## Application Layer

-   **Framework:** Next.js, **Pages Router** (not App Router).
-   One Next.js process serves both the dashboard UI and the Tool
    Gateway API (API routes). No separate backend service.
-   Pages Router is chosen over App Router for implementation
    stability and more predictable AI-assisted code generation, since
    it is a longer-established convention.
-   **UI:** Tailwind CSS + shadcn/ui.
-   **Auth:** Auth.js (NextAuth), email/password for MVP, with OWNER and
    STAFF roles per tenant (multi-staff; see §15.9).

## Database

-   **PostgreSQL.**
-   **ORM:** Prisma.
-   Every table (products, orders, knowledge, memory, audit log)
    includes a `tenant_id` column from day one. All queries and tool
    calls are filtered server-side by `tenant_id`, never inferred from
    conversation content.
-   **Row Level Security (Postgres RLS)** as a second enforcement
    layer beneath application-level `tenant_id` filtering.
-   **pgvector** extension on the same Postgres instance for
    FAQ/knowledge embedding search. No separate vector database.

## Data Ingestion

-   **Excel/CSV:** `exceljs` or `xlsx` (Node).
-   **Google Sheets:** `googleapis` (official Google API client),
    OAuth flow.

## Agent Runtime

-   **OpenClaw**, per HackFest requirement.
-   **Not yet validated:** whether OpenClaw integrates via HTTP
    webhook (which would let the existing Next.js API routes serve
    directly as the Tool Gateway) or requires a dedicated SDK/runtime
    process. Also not yet validated: the resource footprint of running
    an OpenClaw Gateway on a 4 vCPU / 4GB host.
-   This must be confirmed against the official OpenClaw documentation
    before other backend decisions are treated as final, since it may
    change the recommended backend language or process layout.

## Customer Channel (WhatsApp)

The platform supports **two pluggable WhatsApp connection methods**. The
owner chooses one at onboarding when connecting a channel. Both implement
the same internal interface, so the shared inbox (§15.8), the OpenClaw
agent, and the Tool Gateway are identical regardless of the chosen method.

-   **Cloud API (official Meta API).** Webhook-based. ToS-compliant. Uses a
    free test number via Meta for Developers for the demo (no business
    verification required for demo purposes). Free-form human/AI replies
    are allowed within the 24-hour customer service window; proactive
    outbound messages outside that window require pre-approved templates.
    Recommended for UMKM who want the safe, official path. Meta provides a
    free-tier allowance that covers demo-scale usage.
-   **Baileys (bring your own number).** An unofficial WhatsApp Web client
    library (`@whiskeysockets/baileys`) that links the owner's existing
    WhatsApp number by QR/pairing-code login — like WhatsApp Web. Full
    parity: read all messages, reply freely anytime, no templates, no
    per-message fees. **Operates outside WhatsApp's terms of service for
    automated clients; the connected number can be banned.** Mitigation:
    demo on a throwaway test SIM, not a real business number. Chosen by
    UMKM who want full WhatsApp Web parity and accept the risk.

Both connectors are built and shipped in the MVP. The connection is
provider-pluggable: `Channel.provider = CLOUD_API | BAILEYS`, with
provider-specific config stored in `Channel.config`. Baileys runs as a
persistent in-process socket (auth/session state in Postgres, one session
per tenant channel); Cloud API is stateless webhook + Graph API outbound.

## Deployment

-   **Docker Compose** on the provided Ubuntu VPS.
-   Containers: Next.js app, PostgreSQL, OpenClaw Gateway process.
-   **Nginx** as reverse proxy, **Certbot** for TLS (required for the
    WhatsApp webhook and dashboard HTTPS access).
-   No Redis or separate task queue. `node-cron` in the same process
    handles periodic Google Sheets sync, since single-tenant load is
    small.

## Version Control

-   GitHub.

## Explicitly Not Used (and why)

-   **Separate vector database** (Pinecone, Weaviate, etc.) —
    pgvector is sufficient at this scope and avoids an extra running
    service.
-   **Redis / task queue** — unnecessary at single-tenant demo scale.
-   **A shared OpenClaw Gateway as a multi-tenant security boundary** —
    never used. Each tenant gets its own isolated OpenClaw cell/Gateway
    (sections 5 and 26); agents, sessions, workspaces, and credentials
    never cross tenant boundaries.
-   **Vite + separate backend (e.g. Fastify)** — considered, but a
    single Next.js app was chosen to minimize the number of processes
    running on a 4GB host.

------------------------------------------------------------------------

# 23B. Project Structure & Scaffolding Plan

Single Next.js application (Pages Router). One process, one repository, one
deployable. **Not a monorepo** — separation happens at the directory level
inside the app.

## 23B.1 Repository Layout

``` text
csq/
├── prisma/
│   ├── schema.prisma           # all models, tenant_id from day one
│   ├── migrations/             # includes pgvector extension setup
│   └── seed.ts                 # demo tenant: Toko Kopi Nusantara
├── src/
│   ├── pages/
│   │   ├── _app.tsx
│   │   ├── index.tsx           # marketing landing (deferred — section 20A)
│   │   ├── login.tsx
│   │   ├── register.tsx
│   │   ├── dashboard/          # authenticated dashboard (section 15)
│   │   │   ├── index.tsx       # overview
│   │   │   ├── agents/         # agent list, detail, create
│   │   │   ├── data/           # products, imports, source status
│   │   │   ├── knowledge/      # FAQ, policies, documents
│   │   │   ├── memory/
│   │   │   ├── activity/       # audit log
│   │   │   └── settings/       # channels, approvals, source priority
│   │   └── api/                # Tool Gateway + webhooks
│   │       ├── auth/[...nextauth].ts
│   │       ├── tools/          # agent tool endpoints (section 17)
│   │       ├── webhooks/whatsapp.ts
│   │       └── import/         # excel/csv upload, sheets oauth callback
│   ├── components/
│   │   ├── ui/                 # shadcn/ui primitives
│   │   ├── dashboard/          # dashboard-only components
│   │   └── marketing/          # marketing-only components (deferred)
│   ├── lib/                    # server-side shared utilities
│   │   ├── db.ts               # Prisma client singleton
│   │   ├── auth.ts             # NextAuth config + session helpers
│   │   └── permissions.ts      # capability check used by every tool
│   ├── tools/                  # tool definitions + handlers (section 17)
│   │   ├── index.ts            # tool registry
│   │   ├── product.ts
│   │   ├── inventory.ts
│   │   ├── order.ts
│   │   ├── customer.ts
│   │   └── knowledge.ts
│   ├── services/               # external integrations, one module each
│   │   ├── whatsapp.ts
│   │   ├── sheets.ts
│   │   ├── excel.ts
│   │   └── openclaw.ts
│   ├── types/                  # shared TypeScript types + Zod schemas
│   └── styles/globals.css
├── docs/                       # generated docs (plans, audits, research)
├── docker/
│   ├── Dockerfile              # production app image
│   ├── docker-compose.dev.yml  # dev: pgvector Postgres only
│   └── docker-compose.yml      # prod: app + postgres + openclaw gateway
├── .env.example
├── AGENTS.md
├── README.md
└── package.json
```

## 23B.2 Route Model

-   `/` → marketing landing (placeholder until final phase, section 20A)
-   `/login`, `/register` → Auth.js email/password
-   `/dashboard/*` → tenant dashboard, session required
-   `/api/tools/*` → Tool Gateway, agent-facing, permission-checked,
    audited
-   `/api/webhooks/whatsapp` → Meta webhook (GET verify + POST events)
-   `/api/import/*` → Excel/CSV upload and Google Sheets OAuth flow

## 23B.3 Scaffolding Order

Execute in this order. Each step must pass `npm run build` before the
next begins.

1.  `create-next-app` — TypeScript, ESLint, Tailwind, `src/` directory,
    `@/*` import alias, **decline App Router** (it defaults on). Node 20 LTS.
2.  Core dependencies: `prisma`, `@prisma/client`, `zod`, `next-auth`,
    `exceljs`, `googleapis`, `node-cron`.
3.  shadcn/ui init + base components (button, card, input, table, dialog,
    badge, switch).
4.  Prisma init — PostgreSQL provider. First migration enables the
    `vector` extension and creates the initial schema. Create `lib/vector.ts`
    with the standard helper functions (see 23B.6). Seed the demo
    tenant (Toko Kopi Nusantara).
5.  Auth.js credentials provider + User model. Create `withAuth` HOC in
    `lib/auth.ts`. Protect `/dashboard/*` via `getServerSideProps` wrapper
    (no middleware — see 23B.6).
6.  Docker dev database — `pgvector/pgvector:pg16` image via
    `docker-compose.dev.yml` + `.env.example` with all variables.
7.  `git init` + initial commit. Conventional commits from the first
    commit onward.

## 23B.4 Known Technical Constraints

-   **pgvector + Prisma:** Prisma has no native `vector` column type.
    Declare embedding columns as `Unsupported("vector")` in schema.prisma
    and read/write them through raw SQL (`$queryRaw`/`$executeRaw`) in
    `lib/vector.ts` (see 23B.6 convention). The
    `CREATE EXTENSION vector` statement lives in the first migration.
-   **create-next-app defaults to App Router** — it must be explicitly
    declined during scaffolding.
-   **Dev Postgres:** plain `postgres` image lacks pgvector; use the
    `pgvector/pgvector:pg16` image locally and in production.
-   **Validation gates:** `npm run build` + `npm run lint`. No test
    framework initially; add Vitest later only for modules that genuinely
    need unit tests (e.g. permissions.ts).

## 23B.5 Environment Variables

``` text
# Database
DATABASE_URL=

# Auth
NEXTAUTH_URL=
NEXTAUTH_SECRET=

# WhatsApp Cloud API
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=

# Google Sheets
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=

# OpenClaw (TBD — pending integration validation, section 23A)
OPENCLAW_BASE_URL=
OPENCLAW_API_KEY=
```

`.env` is never committed. `.env.example` documents every variable with an
empty value. Secrets stay server-side only — client code never sees them.

## 23B.6 Conventions

-   File naming: kebab-case for pages and components, camelCase for lib
    and service modules.
-   Import alias: `@/*` → `src/*`.
-   Every API route validates its input with Zod before touching Prisma.
-   Every database query filters by `tenant_id` — no exceptions.
-   Component boundaries: `components/dashboard` never imports from
    `components/marketing`, and vice versa.
-   **Vector operations:** All pgvector reads and writes go through a single
    module `lib/vector.ts`. Never raw SQL outside this file. The module
    exposes:
    -   `upsertEmbedding(model, recordId, tenantId, embedding)` — insert or
        replace a vector row via `$executeRaw`.
    -   `findSimilar(model, tenantId, queryEmbedding, options?)` — cosine
        similarity search via `$queryRaw`, returns typed records with a
        `similarity` field. Options: `threshold` (default 0.7), `limit`
        (default 5), `filters` (extra where clauses for agent scope).
    -   `deleteEmbedding(model, recordId, tenantId)` — remove a vector row.
    -   Prisma schema declares the column as `Unsupported("vector")`; the
        actual column type in Postgres is `vector(1536)` (or whatever
        dimension the embedding model requires).
-   **Dashboard auth protection:** Use `getServerSideProps` with a shared
    `withAuth(getServerSideProps)` HOC wrapper. Every page under
    `pages/dashboard/` wraps its `getServerSideProps` (or the page
    component directly for static-ish pages) with `withAuth`. No Next.js
    middleware — it adds complexity for no benefit on a handful of routes.

------------------------------------------------------------------------

# 24. Why This Is More Than a Chatbot

The product is not primarily about generating text.

The agent can:

1.  Understand customer intent.
2.  Retrieve live business information.
3.  Apply business rules.
4.  Decide whether it has permission to act.
5.  Execute business operations.
6.  Update business data.
7.  Ask for human approval when necessary.
8.  Record what it did.

The key product loop is:

``` text
Understand
    ↓
Retrieve
    ↓
Reason
    ↓
Check Permission
    ↓
Act
    ↓
Verify
    ↓
Record
```

------------------------------------------------------------------------

# 25. Product Differentiation

Generic AI customer-service tools typically assume the business already
has structured data and integrations.

This platform is designed around the reality of UMKM:

> **The business already has data, but the data is messy, fragmented,
> and stored in different places.**

The platform therefore focuses on:

-   Data adaptation.
-   Business context.
-   Agent permissions.
-   Controlled actions.
-   Multi-tenant isolation.
-   Deployment simplicity.

Core positioning:

> **Your business doesn't need to change how it works for an AI agent to
> work for you.**

------------------------------------------------------------------------

# 26. OpenClaw Role

OpenClaw should be treated as the agent runtime, not the entire SaaS
product.

OpenClaw provides:

-   Agent runtime.
-   Agent workspaces.
-   Sessions.
-   Skills.
-   Tool execution.
-   Channel connectivity.
-   Per-agent tool policies.
-   Agent-specific configuration.

The platform provides:

-   Tenant management.
-   Business data layer.
-   Data ingestion.
-   External source connectors.
-   Tool authorization.
-   Agent provisioning.
-   Dashboard.
-   Capability management.
-   Approval workflows.
-   Audit logs.

OpenClaw's documentation supports per-agent tool restrictions and
separate workspaces, while its security model recommends separate
Gateway instances for mutually untrusted tenants. The platform should
therefore use an isolated OpenClaw cell/Gateway per UMKM rather than
treating multiple agents in one shared Gateway as a SaaS security
boundary.

------------------------------------------------------------------------

# 27. Key Product Principle

## Read by default. Write by permission. Act by policy.

An agent should not receive unrestricted business access.

Every meaningful action should answer:

1.  What data is being accessed?
2.  Which tenant owns it?
3.  Which agent is requesting it?
4.  Is the capability enabled?
5.  Is human approval required?
6.  Was the action successful?
7.  What changed?

This principle should be visible throughout the dashboard and
architecture.

------------------------------------------------------------------------

# 28. Future Expansion

Once the platform works with Customer Service, the same infrastructure
can support:

### Sales Agent

-   Product recommendations.
-   Lead qualification.
-   Order creation.
-   Follow-up.

### Inventory Agent

-   Stock monitoring.
-   Low-stock alerts.
-   Purchase recommendations.

### Admin Agent

-   Invoice processing.
-   Data entry.
-   Document generation.

### Operations Agent

-   Task coordination.
-   Supplier follow-up.
-   Delivery monitoring.

The platform remains the same.

Only the agent's purpose, tools, instructions, and permissions change.

------------------------------------------------------------------------

# 29. Final Product Definition

**A multi-tenant AI agent platform for UMKM that lets each business
deploy isolated AI employees, connect existing business data, teach
business-specific knowledge and rules, and control exactly what each
agent can read or change.**

The first agent is:

> **Customer Service Agent over WhatsApp**

The platform supports creating multiple agents per tenant, each running
in the tenant's own isolated OpenClaw cell.
with:

-   Internal business data.
-   Excel/CSV import.
-   Google Sheets integration.
-   Business knowledge.
-   Agent memory.
-   Per-capability permissions.
-   Controlled write actions.
-   Human approval.
-   Audit logging.
-   Isolated OpenClaw runtime per tenant.
