# Deferred Engineering Items Register

Date: 2026-11-08
Status: DEFERRED - by owner decision, recorded in PRD 23D. This register
holds the full detail behind the PRD table: what each item is, why it is
deferred, its exact trigger, its scope, and its acceptance criteria. An
item leaves this register only when its trigger fires.

## How to read this register

- DEFERRED is a decision, not neglect: every item has a trigger, and
  building before the trigger is scope creep.
- The one exception is the pre-cutover package, which becomes REQUIRED the
  moment the owner opens the production cutover.
- Scope estimates: S = under a day, M = a few days, L = a week or more.

## 1. Page-splitting (saluran, campaigns, agents) - DEFERRED, scope M

- What: `saluran/index.tsx` (936 lines), `campaigns/index.tsx` (821),
  `agents/index.tsx` (558) each hold the whole page inline - list, forms,
  dialogs. Splitting means extracting those into small components.
- Why deferred: a pure refactor with zero user-visible change, a large
  diff, and regression risk on working screens.
- Trigger: the next feature work on any of those pages.
- When triggered: split only the file being touched, along natural seams
  (one dialog or one list per component), in the same commit as the
  feature.
- Acceptance: build + smoke suite green; the page behaves identically.

## 2. SWR-style inbox client cache - DEFERRED, scope M

- What: the inbox refetches the conversation list every 8 seconds; every
  refresh produces new object references and re-renders the tree. A client
  cache (SWR or equivalent) would dedupe fetches and keep references
  stable between polls.
- Why deferred: it is a data-layer rework of the most business-critical
  screen; the 8s poll is acceptable at current traffic, and the rows are
  already memoized with a content comparator as the cheap first line.
- Trigger: visible inbox lag/jank under real traffic.
- When triggered: introduce the cache behind the existing useApi surface
  (same contract, cached backing), starting with the conversations list.
- Acceptance: no visible lag complaint behind the change; smoke suite
  green; memo comparators still hold.

## 3. Api-keys management UI - DEFERRED, scope S

- What: a dashboard page over the existing, audited, tested routes
  (`/api/dashboard/api-keys` mint/list/revoke).
- Why deferred: no consumer has asked for a key yet; the routes are fully
  usable by curl.
- Trigger: the first real API consumer, or the admin-console work.
- When triggered: an OWNER-only Settings section - list (prefix, name,
  lastUsedAt, revoked), a mint dialog that shows the plaintext token
  exactly once with a copy warning, and a revoke button.
- Acceptance: mint -> use on /api/v1/tools -> revoke -> 401, live.

## 4. Docker Compose for api + worker - DEFERRED, scope M

- What: the `docker/` compose stack still describes the pre-split
  single-app deployment; apps/api and apps/worker have no service entries.
- Why deferred: production runs on Render; the VPS path is not real yet.
- Trigger: the owner decides to deploy on the VPS instead of Render.
- When triggered: add api (web) and worker (background) services mirroring
  the Render topology, plus the same env contract; the Dockerfile pattern
  for the dashboard already exists as the template.
- Acceptance: `docker compose up` runs all three services against one
  Postgres with health checks passing.
- If Render stays the platform forever: never triggered, never built.

## 5. Generated OpenAPI - DEFERRED, scope S-M

- What: the spec at `/api/v1/openapi` is hand-maintained JSON; generated
  means producing it from the route Zod schemas automatically.
- Why deferred: at the current surface (tools, auth, webhook-diag) the
  hand-written spec is clearer than tooling.
- Trigger: /api/v1 grows past roughly a dozen endpoints (the
  mobile/integration era).
- When triggered: generate from zod-to-json-schema at build time; the
  hand-written file is deleted only when the generated one is verified
  equivalent.
- Acceptance: spec stays in sync without manual edits across two
  consecutive endpoint additions.

## 6. Cross-service metrics + alerting - DEFERRED, REQUIRED at cutover

- What: today monitoring means reading each service's logs in Render.
  This item is one health view (dashboard + api + worker) plus alerts.
- Why deferred: no customers ride the monorepo stack yet.
- Trigger: REQUIRED the moment the owner opens the production cutover.
  Rationale: in a three-service architecture the dangerous failure is the
  SILENT one - a dead worker means WhatsApp quietly stops answering while
  the dashboard looks healthy. Someone must get pinged.
- When triggered (the pre-cutover package):
  1. Render-native alerting on all three services (deploys failing,
     health-check failures, log-based error spikes).
  2. The smoke suite (`scripts/smoke-test.ts`) on a schedule (Render cron
     job) against the production stack once cutover lands.
  3. A worker heartbeat log line the alerts can key on.
- Acceptance: killing the worker in a maintenance window produces an alert
  within minutes; the scheduled smoke run posts green.

## 7. packages/ui shared components - DEFERRED, scope M

- What: extracting the components/config duplicated across apps into a
  workspace package.
- Why deferred: the repo rule is extract on the THIRD occurrence. Today
  every duplicated file has exactly TWO copies (dashboard + web, plus the
  api's next-auth.d.ts copy). Two copies are cheaper to maintain than a
  package boundary with three consumers and none of the divergence
  resolved.
- Trigger: the third app needing the same components (apps/admin, or a
  mobile web client).
- Current duplication inventory (accurate as of 2026-11-08):
  - `components/seo.tsx` - 2 copies (dashboard, web), the api does not
    need it (no HTML pages).
  - `lib/utils.ts` (cn) - 2 copies (dashboard, web).
  - `types/next-auth.d.ts` - 2 copies (dashboard, api), extract note
    already in the file.
  - `tailwind.config.ts`, `postcss.config.mjs`, `_document.tsx`,
    `public/icon.svg`, `public/og.svg` - 2 copies each (dashboard, web).
  - `styles/globals.css` - 2 diverged copies: web holds the FULL
    pre-Phase-3 file (including inbox/landing css it never renders -
    prune when extracting), dashboard holds the pruned version.
  - NOT duplicated: all shadcn/ui primitives (button, card, dialog,
    input, select, table, ...) exist only in the dashboard; web's landing
    is custom CSS and uses none of them.
- When triggered: `packages/ui` gets the shadcn primitives, cn, Seo, and
  the shared tailwind/css base; each app keeps its app-specific components.
- Acceptance: all three apps render identically after the swap; the
  encoding guard covers packages/ui.

## Leaving this register

An item is done when its trigger fired, the work shipped, and its
acceptance criteria passed. Then it moves to the changelog and its row in
PRD 23D is removed. Nothing is removed by preference, only by trigger.
