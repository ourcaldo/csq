# Enterprise Architecture Plan (PRD 23C)

Date: 2026-11-08
Owner decision (enterprise escalation): the API and the channel runtime
become separate services; the dashboard becomes UI + BFF. Resilience
requirement: a broken or deploying dashboard must never affect the API or
the customer-serving runtime. Supersedes PRD section 23's single-process
choice and the AGENTS.md stack constraint. Absorbs Phase 5 (channel worker)
of docs/2026-11-08-monorepo-migration-plan.md.

## 1. Why

1. The 2026-11-07 incident: UI deploys restarted the WhatsApp session and
   two instances fought over one socket. The lease contained the fight, but
   every deploy of the shared process still churns live customer sessions -
   the coupling itself is the defect.
2. Enterprise positioning: the API is a product with its own consumers
   (dashboard, future mobile app, future admin console, integrations) and
   its own lifecycle - versioned contracts, token auth, rate limits,
   documentation.
3. The owner's resilience rule: dashboard broken or deploying does not mean
   the API or the customer-serving runtime is affected.

## 2. Target layout

```text
csq/
  apps/
    web/         public site (done - no server surface)
    dashboard/   operator console: UI + BFF. Session auth (NextAuth), SSE
                 inbox streams, thin session-scoped routes. No sockets,
                 no Tool Gateway.
    api/         the product API: /api/v1 versioned contracts, token auth,
                 Tool Gateway HTTP, WhatsApp webhooks, media serving, rate
                 limits, request IDs, OpenAPI. Stateless.
    worker/      the customer-serving runtime: WhatsApp sockets (the ONLY
                 socket owner), scheduler, campaign ticks, outbox drain,
                 QR/session provisioning. Long-lived state, no public HTTP.
    admin/       future platform console (blocked on its PRD section)
  packages/core/ all domain logic (already extracted - apps stay thin)
```

## 3. Service contracts

### dashboard (becomes UI + BFF)

-   Keeps: NextAuth session, all dashboard pages, the SSE inbox streams
    (plain DB reads), session-scoped REST routes for UI concerns.
-   Loses: Baileys socket handling, scheduler boot, the Tool Gateway routes,
    the Meta webhook, media serving.
-   Send actions (conversation reply, test send, campaign fire) become
    outbox writes; the UI renders send status from the DB.

### api

-   New /api/v1 namespace for every external contract. Mobile and
    integrations authenticate with short-lived JWT access tokens plus
    refresh tokens; the dashboard BFF calls with an internal service token
    (env secret, internal header).
-   Zod validation at every boundary (unchanged repo rule), request IDs,
    rate limits on the auth + webhook routes, an OpenAPI scaffold generated
    from the route schemas.

### worker

-   Owns: Baileys sockets, the scheduler and cron ticks (Sheets sync,
    scenario engine, campaign drain, outbox drain), QR/connect/session
    provisioning.
-   The dashboard's connect/disconnect/test flows become DB command rows
    the worker polls: connect requested, worker connects, QR/status written
    to the DB, dashboard polls (which it already does).
-   The SystemLock session lease stays. It no longer guards cross-web-
    instance fights (none remain once sockets leave the web tier) but it
    still guards accidental dual-worker boots and keeps every cron tick
    single-executed.

## 4. The send path (the one real protocol change)

Today dashboard send routes call the socket in-process. After the split no
web process holds a socket, so all outbound sends become OutboundMessage
rows: tenantId, channelId, toJid, kind (text/image/template), payload,
unique idempotencyKey, status (QUEUED/SENDING/SENT/FAILED), error,
timestamps - drained by the worker every few seconds. This is the exact
pattern CampaignMessage already uses, generalized to every send. Cloud API
(stateless HTTP) and Baileys sends both flow through the outbox: one
uniform path, one retry policy, one audit surface.

Trade-off, stated honestly: send latency grows from in-process (ms) to the
drain interval (2-3s). Acceptable for customer-service replies (WhatsApp
itself is asynchronous) and campaign pacing already works this way. If CS
latency complaints ever become measurable, revisit with evidence.

## 5. Auth realms

-   Dashboard session: unchanged (NextAuth cookies).
-   API tokens: /api/v1/auth/token. Phase 7 ships the service-token path
    (dashboard BFF to api) plus one programmatic token type; user-token
    exchange for mobile lands with the mobile work (Phase 8).
-   Worker: no public surface at all.

## 6. Phases (executed on the monorepo branch, each deployable)

### Phase 6 - apps/worker (channel runtime split)

1. New workspace app: a plain node process (no Next.js) running the
   scheduler, Baileys, and campaign ticks from packages/core.
2. OutboundMessage table + migration; dashboard send/test/campaign routes
   enqueue instead of sending.
3. Connect/QR/disconnect via DB command rows; the dashboard connect route
   writes a request, the worker executes it, the UI gets a pending state.
4. Deploy as a Render background worker service; remove socket boot from
   the dashboard app.
5. Acceptance: a dashboard deploy does not churn the WhatsApp session;
   replies, test sends, and campaigns deliver; QR pairing works end to end;
   the monolith (main) stays untouched.

### Phase 7 - apps/api (the product API)

1. New Next.js API-only app; move the Tool Gateway HTTP surface, the Meta
   webhook, and media serving out of the dashboard.
2. /api/v1 namespace, token auth (service tokens first), rate limits,
   request IDs, OpenAPI scaffold.
3. The dashboard keeps its session routes as a BFF calling shared logic via
   packages/core directly; BFF routes migrate onto the versioned API over
   time (dogfooding) - not required in Phase 7.
4. Acceptance: api deploys never touch the worker; the dashboard is
   unchanged for users; a token-authenticated /api/v1 call succeeds;
   webhooks land on api.

### Phase 8 - mobile realm + admin (later)

-   Mobile (React Native) gets user-token exchange plus the /api/v1
    surface. Trigger: mobile work starts.
-   apps/admin remains blocked on its SaaS-operator PRD section.

## 7. Infrastructure

-   One Neon database, never split. Two new Render services: api (web) and
    worker (background). Correlation IDs flow via request headers and
    structured logs; the outbox gives per-send auditability across
    services.
-   Independent deploys are the point: dashboard, api, and worker each
    deploy on their own cadence. Deploy overlap only matters WITHIN the
    worker, and the lease guards that.
-   Cost line item, owner-approved: two additional Render instances.

## 8. Risks and mitigations

-   Send latency +2-3s (drain interval): bounded, measurable, acceptable
    for the CS use case; revisit only with evidence.
-   QR/connect becomes async: small dashboard UX change (pending state);
    the polling UI already exists.
-   More services to operate: all state remains in Postgres, logs stay
    centralized in Render, no new infrastructure categories.
-   Dual-worker boot accident: the SystemLock lease already prevents it.

## 9. Explicitly out

OAuth client grants, SSO, per-tenant API-key management UI, rate-limit
dashboards, Redis or any queue infrastructure, splitting the database, and
any admin-console work before its PRD section exists.
