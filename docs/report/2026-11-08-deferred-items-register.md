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

## 1. Page-splitting (saluran, campaigns, agents) - DONE 2026-11-09

- What: `saluran/index.tsx` (936 lines), `campaigns/index.tsx` (821),
  `agents/index.tsx` (558) each held the whole page inline - list, forms,
  dialogs. Splitting means extracting those into small components.
- Why it was deferred: a pure refactor with zero user-visible change, a
  large diff, and regression risk on working screens.
- Trigger: owner direction 2026-11-09 (build all remaining PRD 09 items).
- Shipped: saluran 939 to 441 lines (`components/dashboard/channels/`:
  method card, connected card, Cloud API form, Baileys form, edit form,
  field primitives, toast), campaigns 822 to 402
  (`components/dashboard/campaigns/`: table, runs dialog, wizard steps,
  format helpers), agents 558 to 225 (`components/dashboard/agents/`:
  types/tool groups, KPI row, card, dialog). Behavior unchanged.
- Acceptance: dashboard build green after the split; each page keeps its
  existing state and handlers.

## 2. SWR-style inbox client cache - DONE 2026-11-09

- What: the inbox refetched the conversation list every 8 seconds; every
  refresh produced new object references and re-rendered the tree.
- Why it was deferred: it is a data-layer rework of the most
  business-critical screen; the 8s poll was acceptable at current traffic.
- Trigger: owner direction 2026-11-09 (build all remaining PRD 09 items).
- Shipped: `usePolledApi` (`apps/dashboard/src/hooks/use-polled-api.ts`) -
  polling lives in the hook, overlapping requests are skipped, previous
  data stays during revalidation, and an unchanged payload keeps the same
  object reference so memoized rows do not re-render. The inbox uses it in
  place of the page-level `setInterval`.
- Acceptance: dashboard build green; the list still refreshes every 8s and
  selection survives refreshes.

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

## 4. Docker Compose for api + worker - DONE 2026-11-09

- What: the `docker/` compose stack described the pre-split single-app
  deployment; apps/api and apps/worker had no service entries.
- Why it was deferred: production runs on Render; the VPS path is not real
  yet.
- Trigger: owner direction 2026-11-09 (build all remaining PRD 09 items).
- Shipped: multi-target `docker/Dockerfile` (dashboard and api on Next
  standalone output, worker on tsx with the workspace sources); compose
  services for api (384m) and worker (512m) with the Render env contract;
  nginx routes `/api/v1`, `/api/media` and the Meta webhook to api; worker
  health published on `127.0.0.1:10000`; `setup-vps.sh` pulls all four
  images and documents the health checks; `.dockerignore` added.
- Acceptance: compose YAML parses, the API standalone build passes, and
  the encoding gate is green. The image build itself was NOT executed
  (Docker is not installed on the development machine) - verify with
  `docker build --target dashboard|api|worker` before the first VPS deploy.

## 5. Generated OpenAPI - DONE 2026-11-09

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

## 6. Cross-service metrics + alerting - DONE 2026-11-09

- What: monitoring used to mean reading each service's logs in Render.
  This item is one health view (dashboard + api + worker) plus alerts.
- Why it was deferred: no customers rode the monorepo stack yet; the
  dangerous failure in a three-service architecture is the SILENT one - a
  dead worker means WhatsApp quietly stops answering while the dashboard
  looks healthy.
- Trigger: owner direction 2026-11-09 (build all remaining PRD 09 items).
- Shipped:
  1. The admin console Overview (PRD 13) remains the health VIEW.
  2. `scripts/alert-check.ts` (`npm run check:alerts`) probes dashboard
     `/api/health`, api `/api/health`, the worker health listener, and a
     `worker-heartbeat` SystemLock; it posts failures to
     `ALERT_WEBHOOK_URL` with a 30-minute same-failure cooldown and exits
     1 so the scheduler records the failure.
  3. The worker upserts the heartbeat every 30s with a 90s TTL, proving
     the scheduler/channel loop is executing, not just the HTTP listener.
- Acceptance: healthy path exits 0; a failing probe exits 1 with the
  service named; the failure path was exercised locally. Scheduling the
  check against production and killing the worker live remain part of the
  cutover package.

## 7. packages/ui shared components - APPROVED 2026-11-08 (trigger fired early)

Status change: deferred register item 7 was fired early by owner
direction on 2026-11-08 evening. The PRD is `docs/prd/12-shared-ui-package.md`
and the execution plan is `docs/plans/2026-11-08-shared-ui-package-plan.md`.
The scope below is superseded by those documents - in particular, the
honest boundary they draw: only the design-system layer moves
(cn, shadcn primitives, Seo, theme preset, css base); `_document.tsx`,
app-specific css, static assets, and `next-auth.d.ts` stay app-local
because sharing them would over-couple the apps. This entry stays for
the record of the original duplication inventory.

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
