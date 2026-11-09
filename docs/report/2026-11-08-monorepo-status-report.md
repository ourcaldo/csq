# Monorepo Status Report

Date: 2026-11-08 (evening)
Prepared at the owner's request: the current situation and condition of the
monorepo, everything that shipped, and an honest record of the mobile auth
realm that was built although no mobile app was planned.

> Dated supersession note 2026-11-09 (PRD 16 DOC-6): this is a point-in-time
> snapshot. Everything marked NOT BUILT below has since been built and
> deployed: `apps/admin` (PRD 13), page-splitting, the generated OpenAPI,
> the alerting pipeline (`npm run check:alerts`), the admin API-key page,
> RLS activation, and the full PRD 16 remediation. Read sections 41-43 and
> the open-items list as history, not as the current state. For the current
> state see PRD 09 (all items done) and PRD 16 (implementation status).

## 1. Where things stand

The CSQ product exists as TWO parallel stacks:

- **Monolith (PRODUCTION)** - the original single Next.js app on `main`,
  serving real customers at https://csq-xmhq.onrender.com, holding the one
  real WhatsApp session. Frozen: nothing may be pushed to `main`, and the
  old `csq` Render service must not be touched, until the owner explicitly
  says otherwise (AGENTS.md owner directive).
- **Monorepo (TESTING)** - the enterprise architecture, fully built and
  live on the `monorepo` branch, running against a CLONED database (a
  snapshot of production data taken 2026-11-08). Everything can be tested
  and broken there without touching production.

The monorepo is proven (all phases shipped, all gates green) and waiting on
one owner decision: the production cutover (merging `monorepo` into `main`
and retiring the monolith). That decision is deliberately frozen.

## 2. Repository structure

```text
csq/
  apps/
    dashboard/   Operator console: UI + BFF. Session auth (NextAuth),
                 SSE inbox streams, thin session-scoped routes. No sockets,
                 no ticks, no Tool Gateway, no webhook.
    worker/      The customer-serving runtime: WhatsApp sockets (the ONLY
                 socket owner), all cron ticks, the outbound outbox drain,
                 connect/QR/disconnect command execution. Plain node process.
    api/         The product API: /api/v1 token realm, Tool Gateway HTTP,
                 Meta webhook, media serving, OpenAPI. Stateless.
    web/         Public marketing site. Built, NOT yet deployed as its own
                 service (one Render service away, on the owner's ask).
    admin/       NOT BUILT - PRD + plan now exist (PRD file 13 +
                 docs/plans/2026-11-08-admin-console-plan.md);
                 execution on owner go.
  packages/
    core/        All domain logic: prisma schema/migrations, inbox,
                 agent loop, campaign engine, tools (the Tool Gateway
                 registry), baileys + channel runtime, system locks,
                 auth helpers, types + zod schemas.
  scripts/       Self-checks (8 suites, 79 asserts), the live smoke suite,
                 encoding guard, migration checksums.
```

Hard rules that hold mechanically: core never imports from an app (grep-
verified); apps never import each other; only `apps/worker` may connect a
WhatsApp socket; Postgres is the only infrastructure (queues are tables).

## 3. Deployed infrastructure

| | Monolith (PRODUCTION) | Monorepo (TESTING) |
|---|---|---|
| Code | `main` (frozen) | `monorepo` branch |
| Services | `csq` / srv-dbjlj2p42hec73dcu53g / csq-xmhq.onrender.com | `csq-dashboard` / srv-dbo02jbrjlhs73a2375g, `csq-worker` / srv-dbo3kn7f3r2c73a3g8l0, `csq-api` / srv-dbo418jm8hqs73fgdl0g |
| Database | Neon project `CSQ` (winter-flower-03790042), default branch br-billowing-base-b3cv56yi | same project, branch `monorepo` (br-still-queen-b3mydc3y) - a clone with channels DISCONNECTED and Baileys creds deleted, so the two stacks can never fight over the one WhatsApp session |
| WhatsApp session | the real one | none by design |

All services are Singapore, standard plan, auto-deploy on branch pushes.
Full touch rules and the mandatory clone-neuter procedure live in
AGENTS.md ("Infrastructure Topology and Touch Rules") - those are binding.

Environment highlights (values themselves live only in the Render
dashboard): the api holds `API_SERVICE_TOKENS` + `API_JWT_SECRET`; the
dashboard holds `API_URL` + `API_SERVICE_TOKEN` plus the LLM config; the
worker holds `API_URL` plus the LLM config. The LLM endpoint is Neon's AI
gateway and works (the long-standing production 404 was a config typo - a
doubled `/v1/chat/completions` path - diagnosed and fixed on 2026-11-08).

## 4. What shipped (2026-11-08, chronological)

- **Monorepo plan + PRD 23B.0** (f669211) - the phased migration plan.
- **Phase 1** (9cbab42) - npm workspaces skeleton; app moved to
  `apps/dashboard` unchanged.
- **Phase 2** (3a1dc5e) - `packages/core` extracted; 652 imports rewritten
  to `@csq/core`.
- **Phase 3** (354d6bd) - the public landing moved to `apps/web`; the
  dashboard root redirects to `/dashboard`.
- **Enterprise escalation** (8c49183) - PRD 23C + the enterprise
  architecture plan; the single-process constraint formally superseded.
- **Phase 6** (16827bf) - `apps/worker`: the channel runtime split.
  OutboundMessage outbox + ChannelCommand queue; the dashboard became
  UI+BFF. Deployed live as `csq-worker`.
- **Phase 7** (418bccf) - `apps/api`: the /api/v1 token realm (service
  tokens + tenant API keys), Tool Gateway/webhook/media moved, request
  IDs, rate limiting, OpenAPI. Deployed live as `csq-api`.
- **Phase 8** (284cb84) - the user token realm (see section 6).
- **Standardization pass** (f5caa84, fa3b1a3) - last build warning killed,
  memoized inbox rows, the live smoke suite (13 checks).

Each phase passed the full gate before shipping: `npm run build`,
`npm run build:api`, all self-check suites, `npm run check:encoding`.

## 5. The auth realms (complete picture)

| Realm | Credential | Who it is for | Where it works |
|---|---|---|---|
| Session | NextAuth cookie (httpOnly) | humans in the browser | dashboard routes |
| Service token | env secret (`API_SERVICE_TOKENS`) | our own services (e.g. the dashboard's webhook-diag proxy) | non-tenant /api/v1 endpoints |
| API key | `csq_...` sha256-hashed, soft-revoked | machines: integrations, tenants' programmatic access | tenant-scoped /api/v1 (tools) |
| User JWT | 15-min HS256 access + 30-day rotated refresh token | humans WITHOUT a browser (integrations, future admin console, and - hypothetically - a mobile app) | /api/v1 (tools today, more endpoints later) |

Multi-tenant scoping is unchanged everywhere: tenantId is resolved
server-side from the credential, never from request content, and every
mutation is audit-logged.

## 6. The mobile auth realm - an honest record

**What exists:** three endpoints on the api (`/api/v1/auth/token`,
`/api/v1/auth/refresh`, `/api/v1/auth/logout`), the `RefreshToken` table,
the JWT library (jose), and the full lifecycle semantics: credential
exchange, rotation that always revokes the presented refresh token
(replay = 401), idempotent logout revocation, timing-equalized login,
per-IP rate limiting, audit logging. Verified live by the smoke suite
(steps 8-12).

**What does NOT exist:** any mobile app, any mobile UI, any
mobile-specific data endpoints. Nothing else was built for mobile.

**The honest history:** no mobile app was ever planned by the owner. The
auth realm was built on an inference chain - the owner installed React
Native skills "for later", the product was escalated to enterprise
positioning, and the enterprise plan (written by the agent, approved as a
whole) named a "mobile realm" in Phase 8 with the trigger "mobile work
starts". When the owner said "continue Phase 8 till it's finished", the
agent treated that as approval for the buildable half - without first
confirming that the mobile roadmap itself was real. The owner confirmed on
2026-11-08 evening: "Actually, I didn't have plan to make it."

**The owner's decision: keep it** ("just leave it"), and the reasons it
stays are sound independent of mobile:

1. An enterprise API needs a human-without-a-browser credential path
   regardless - this is the standard bearer-token flow of any public API.
2. The future `apps/admin` console will authenticate against the api
   exactly this way.
3. Third-party integrations that act on behalf of a user need it.
4. It completed the /api/v1 auth story (services / machines / humans).

**Reframing:** the feature is now called the **user token realm**. If a
mobile app ever becomes real, its login flow is done; if it never does,
nothing is orphaned. The lesson is recorded in AGENTS.md: a plan phase
with a trigger is a question, not an approval - confirm the trigger
before building.

## 7. Quality gates and how to verify

```bash
npm run build                      # dashboard build + typecheck (zero warnings)
npm run build:api                  # api build + typecheck
npx tsx scripts/self-check-api-jwt.ts        # and the 7 other self-check-*.ts
npx tsx scripts/smoke-test.ts      # 13 live end-to-end checks against the
                                   # deployed stack (health, real login,
                                   # session routes, auth-realm lifecycle)
npm run check:encoding             # the em-dash/mojibake guard
```

Current state: all green, re-verified 2026-11-08 evening. The smoke suite
doubles as a production-health probe for the test stack - run it before
any merge conversation.

## 8. Open items

Deliberately deferred (with reasons, not forgotten):

- **Page splitting** for the big UI files (saluran 936 lines, campaigns
  821) - tied to feature work on those pages, not a standalone refactor.
- **SWR-style client cache for the inbox** - the real fix for render churn
  on the polled list; a data-layer rework of the most critical screen.
- **Api-keys management UI** - the routes exist and are audited; the page
  can come with the admin work.
- **Docker Compose entries for api/worker** - Render-first per the plan;
  the VPS path updates when the VPS deploy becomes real.
- **Generated OpenAPI** - the hand-maintained scaffold is correct at the
  current surface size.
- **Cross-service metrics/alerting** - Render logs today; the admin
  console Overview (PRD 13) delivers the health view; the alerting half
  remains REQUIRED at the production cutover (docs/prd/09).

Owner decisions pending (not engineering):

1. **Production cutover** - merge `monorepo` to `main`, retire the
   monolith, point production at the new stack. Frozen until the owner
   opens it. The rollback and sequencing are already designed.
2. **`apps/admin`** - PRD + plan written (file 13); awaiting the owner's
   go for the phased execution.
3. **apps/web deployment** - one Render service away, on the owner's ask.

## 9. Key facts for future sessions

- Never merge `monorepo` into `main` or touch the `csq` service without an
  explicit owner instruction (AGENTS.md directive).
- Every (re)clone of the database for the monorepo stack MUST be neutered
  first (AGENTS.md has the exact SQL) or the clone 440-fights production
  over the single WhatsApp session.
- The clone is a snapshot; new production messages do not appear in it.
- Login on the test stack: admin@tokokopi.id / demo1234 (same as
  production, since the clone copied it).
- The channel on the clone is DISCONNECTED by design; pairing a second
  WhatsApp number there gives a fully isolated end-to-end test loop -
  including working AI replies (the LLM config is correct on this stack).
