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

