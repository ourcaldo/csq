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
-   **Vite + separate backend (e.g. Fastify)** - considered, but a
    single Next.js app was chosen to minimize the number of processes
    running on a 4GB host. **Superseded 2026-11-08 (PRD 23C, enterprise
    escalation): the API and the channel runtime become separate services.**

------------------------------------------------------------------------

