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

> **Owner decision 2026-11-08 (escalation):** the product grows beyond the
> single-tenant demo into three frontends over time - the public UI
> (section 20A, now its own app: apps/web), the tenant dashboard
> (apps/dashboard, the existing app), and later a platform admin console
> (apps/admin). The repository restructures into an npm-workspaces monorepo
> per `docs/plans/2026-11-08-monorepo-migration-plan.md` and PRD 23B.0. The
> SaaS-operator scope that apps/admin implies (tenant provisioning, plans,
> monitoring) needs its own PRD section before that app is built; until
> then the out-of-scope list above still governs the MVP slice.



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

-   Same stack (Pages Router, Tailwind, shadcn/ui), but as its own
    workspace app (`apps/web`) under the monorepo plan - not routes inside
    the dashboard app. The dashboard and public UI deploy independently.
-   **Lowest priority.** Built only after all MVP functionality is complete,
    tested, and the demo flows are verified. Nothing here blocks the HackFest
    deliverable.
-   Must not interfere with or complicate the dashboard and API route
    structure. Marketing routes live at the top level; dashboard routes live
    under `/dashboard/` or similar — clean separation from day one.
-   Static or minimally dynamic. No backend data required for marketing
    content. Product copy, screenshots, and diagrams are sufficient.

------------------------------------------------------------------------

