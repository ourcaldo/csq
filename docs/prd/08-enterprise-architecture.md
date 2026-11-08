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
    (PRD: file 13; execution on owner go).
-   `packages/core` - all domain logic, unchanged; apps stay thin over it.

## Non-negotiables

-   Resilience isolation: deploys or failures of dashboard/web/api never
    drop the worker's sockets. The customer path (WhatsApp inbound -> agent
    turn -> reply) runs entirely in the worker over core.
-   One socket owner: only `apps/worker` connects WhatsApp. The SystemLock
    session lease stays as anti-dual-boot safety.
-   Sends flow through a Postgres outbox (`OutboundMessage` rows drained by
    the worker) - the same pattern the campaign engine already uses.
-   Every external contract is versioned and Zod-validated; programmatic
    auth is token-based, never session-coupled.
-   Multi-tenant scoping unchanged: tenantId resolved server-side, every
    mutation audited.

## Execution

Phased, each phase leaving production deployable:
`docs/plans/2026-11-08-enterprise-architecture-plan.md` - Phase 6 extracts
`apps/worker` (absorbing the old plan's Phase 5), Phase 7 extracts
`apps/api` with the token realm, Phase 8 opens the mobile realm.

