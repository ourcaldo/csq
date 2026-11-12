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

Amendment 2026-11-11 (owner decision, after observing an unscoped memory): **a
memory belongs to ONE customer.** `customerPhone` is stamped server-side from
the conversation at create time (the model cannot choose or see it);
`memory.search` returns only the current customer's memories; HIGH-importance
prompt injection is filtered to the current customer; the Memori page shows
the customer column. The agent can never read another customer's memories.
Business-level facts (store hours, policies) do NOT belong in memory - that is
what the knowledge base is for; `memory.create`'s description steers the
model accordingly. Existing unscoped rows were test data and were wiped by
the migration (20261111100000) rather than guessed into customers.

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
    Amendment 2026-11-10 (owner decision, for the KPI work): **a human reply
    is a takeover.** When OWNER/STAFF send a customer-facing reply from the
    inbox on a conversation not already theirs, the conversation is
    reassigned to them immediately (assignee set, AI assignment cleared,
    audited) - replying to a chat another human owns reassigns it to the
    replier. The AI stands down from that moment, so it never answers on top
    of a human who is actively handling the chat. Private notes do NOT take
    over (internal only). The existing explicit "Ambil alih / Lepas" actions
    stay.
-   **Tags / labels:** conversations can be tagged (e.g., "needs
    follow-up", "VIP", "refund") and filtered by tag.
-   **Status:** OPEN / PENDING / RESOLVED, with filtering.
-   **Human/AI handoff:** a conversation can flow AI → human → AI. When a
    human is assigned, the AI agent stands down for that conversation
    until reassigned back.
    Amendment 2026-11-11 (owner decision, session auto-close): the agent's
    session can close itself, per tenant configuration. When the tenant
    enables auto-close (Settings, OWNER-only; default OFF) with an idle
    window (15-1440 minutes, default 60): an OPEN, AI-owned conversation
    whose LAST message is the agent's reply and whose customer has been
    silent for the window gets the `session_end` goodbye message, the
    session is marked closed, and the conversation status becomes RESOLVED.
    An unanswered CUSTOMER message never triggers an auto-close (the
    customer is waiting, not done - that is a gap for staff, not a
    closure). The next customer inbound reopens the conversation (RESOLVED
    back to OPEN) and starts a fresh history window. Human-owned
    conversations are excluded; staff close their own chats. The 1-hour
    bounded agent history window is unchanged - it is a context rule, not
    the session-close timer.
    Amendment 2026-11-12 (owner decisions, vision + identity guardrail):
    the agent reads customer PHOTOS. An inbound image (caption or not, bytes
    stored as a MediaAsset, 4 MB cap) drives a normal agent turn with the
    photo attached as vision input on the triggering message only - the
    replayed history stays text-only, so the prompt stays bounded regardless
    of how many photos arrive. Non-image media (video/audio/document) keeps
    the ingest-time courtesy reply. Independently, the system prompt
    forbids the agent from ever naming its model/AI/technology (Gemini, GPT,
    ChatGPT, etc.) to the customer - it identifies only as the store's CS
    assistant. The image rides in the OpenAI image_url format, so the
    capability is provider-agnostic across OpenAI-compatible providers.
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

