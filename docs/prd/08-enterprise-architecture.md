# 23C. Enterprise Service Architecture (owner decision 2026-11-08)

The product is developed for enterprise use, not as a single-owner tool.
The owner's resilience requirement: a broken or deploying dashboard UI must
never affect the API or the customer-serving runtime. This supersedes the
single-process choice in section 23 ("Vite + separate backend ... a single
Next.js app was chosen to minimize processes") and the matching stack
constraint in AGENTS.md. Next.js Pages Router stays for every web app;
Postgres stays the only data store (no Redis, no queue service - queues
are tick-drained tables). What changes is the service topology.

## Target services

-   `apps/dashboard` - operator console UI + BFF. Keeps session auth
    (NextAuth), the SSE inbox streams (plain DB reads), and thin
    session-scoped routes. No longer owns sockets or the Tool Gateway.
-   `apps/api` - the product API: versioned contracts (`/api/v1`), token
    authentication (short-lived JWT access + refresh for programmatic and
    mobile clients, internal service tokens for the dashboard BFF), the
    Tool Gateway HTTP surface, WhatsApp webhooks, media serving, rate
    limiting, request IDs, OpenAPI documentation. Stateless.
-   `apps/worker` - the customer-serving runtime: the ONLY WhatsApp socket
    owner (Baileys channels), scheduler, campaign engine ticks, and the
    outbound-send outbox drain. Long-lived state lives here; web deploys
    never restart it.
-   `apps/web` - public site (unchanged). `apps/admin` - platform console
    (PRD: file 13). Dated note 2026-11-09 (PRD 16 DOC-3): admin is BUILT and
    deployed (PRD 13).
-   `packages/core` - all domain logic, unchanged; apps stay thin over it.

## Non-negotiables

-   Resilience isolation: deploys or failures of dashboard/web/api never
    drop the worker's sockets. The customer path (WhatsApp inbound -> agent
    turn -> reply) runs entirely in the worker over core. Dated note
    2026-11-09 (PRD 16 OPS-7): for CLOUD_API inbound the webhook itself
    lives in `apps/api` (Phase 7 plan), so the inbound ingest and agent turn
    for the official channel execute there - stateless HTTP sends, no
    sockets. The worker stays the ONLY socket owner; every Baileys-path
    customer turn runs in the worker.
-   One socket owner: only `apps/worker` connects WhatsApp. The SystemLock
    session lease stays as anti-dual-boot safety.
-   Sends flow through a Postgres outbox (`OutboundMessage` rows drained by
    the worker) - the same pattern the campaign engine already uses. Dated
    note 2026-11-09 (PRD 16 OPS-7): outbox scope in practice - conversation
    and test sends from socket-less processes flow through the outbox;
    sends initiated inside the worker (agent replies on Baileys inbound,
    scenario nodes, session-close) send in-process where the socket lives,
    and the campaign engine keeps its own per-recipient `CampaignMessage`
    rows with an atomic PENDING -> SENDING claim (COR-1). "All sends"
    would duplicate state without adding a guarantee; the per-recipient
    claim and the outbox row are the two idempotency units that exist.
-   Every external contract is versioned and Zod-validated; programmatic
    auth is token-based, never session-coupled.
-   Multi-tenant scoping unchanged: tenantId resolved server-side, every
    mutation audited. Dated note 2026-11-09 (PRD 16 SEC-1): the second
    enforcement layer is now LIVE - Postgres RLS with a dedicated non-owner
    app role and per-request tenant context; see tenant-context.ts.

## Execution

Phased, each phase leaving production deployable:
`docs/plans/2026-11-08-enterprise-architecture-plan.md` - Phase 6 extracts
`apps/worker` (absorbing the old plan's Phase 5), Phase 7 extracts
`apps/api` with the token realm, Phase 8 opens the mobile realm.

