# Staff KPI Implementation Plan (2026-11-10)

Implements PRD 17 (`docs/prd/17-staff-kpi.md`). Do not start before the
owner approves the PRD. All work on the `monorepo` branch and the clone
database; production cutover stays frozen.

## Design summary

- New tables: `KpiTarget` (configuration) and `KpiSnapshot` (closed-period
  history). No changes to existing tables - all metrics are computed from
  `Message`, `Order`, and `DealStageHistory` rows.
- Computation lives in `packages/core/src/lib/kpi.ts`, shared by the
  dashboard API (current period, live) and the worker scheduler (snapshot at
  period close). One code path per metric - never two.
- Periods are Asia/Jakarta calendar windows (PRD 17.3). Period math uses the
  `Intl.DateTimeFormat` timeZone offset trick or a small date-table helper -
  no date-fns/tz dependency.
- RLS: both tables get policies + `csq_app` grants in the migration,
  following the exact pattern of the PRD 16 SEC-1 migrations.

## Phase 0 - Reply-as-takeover (PRD 03 amendment 2026-11-10, prerequisite)

The KPI semantics assume it, and it fixes a real inbox defect: today a
human reply leaves the chat assigned to the AI, so the AI keeps
auto-answering the customer while a human is handling them.

- [ ] `sendHumanReply` (packages/core/src/lib/inbox.ts): after a successful
      reply, if the conversation is not already assigned to the sender,
      reassign (assigneeUserId = sender, assignedAgentId = null) via the
      existing `assignConversation` so the XOR invariant and audit path
      hold; the takeover is audited (conversation.reassign-style row with
      the reason "reply").
- [ ] Private notes (notes route) explicitly do NOT reassign.
- [ ] Manual verification on the clone: reply from the inbox on an
      AI-handled chat -> list badge flips to "Diambil alih tim", AI badge
      gone; next inbound gets no AI reply until released; a reply by a
      second staff member reassigns to them; "Lepas" gives it back to the
      AI.

## Phase 1 - Data model

- [ ] `packages/core/prisma/schema.prisma`: `KpiTarget` model
      (tenantId, scope `TENANT|USER`, userId nullable + FK User SetNull,
      metric `ORDERS|DEALS_WON|FIRST_RESPONSE|REPLIES`,
      period `DAY|WEEK|TWO_WEEK|MONTH`, thresholdMinutes Int?,
      targetValue Decimal->Float (use Int for percent + Int for counts? use
      Float, simplest), active Boolean, timestamps; index (tenantId, active)).
- [ ] `KpiSnapshot` model (tenantId, kpiTargetId + FK Cascade, periodKey,
      periodStart, periodEnd, actualValue Float, targetValue Float,
      achieved Boolean, meta Json?, createdAt;
      unique (kpiTargetId, periodKey); index (tenantId, kpiTargetId,
      periodKey)).
- [ ] Migration with RLS policies + `csq_app` grants (copy the pattern from
      the most recent PRD 16 migration).
- [ ] Prisma enums: `KpiMetric`, `KpiPeriod`, `KpiScope` - or plain string
      unions in types + `String` columns (match the codebase's existing
      convention for ConversationStatus etc. - check first, be consistent).
- [ ] `packages/core/src/types/kpi.ts`: shared TS types + Zod schemas for
      create/update payloads.

## Phase 2 - Core computation (`packages/core/src/lib/kpi.ts`)

- [ ] `periodWindow(period, at)` -> `{ key, start, end }` in Asia/Jakarta
      (day / Mon-Sun week / 1-14 + 15-end two-week / calendar month).
- [ ] `computeActual(target, from, to)` -> number, one query per metric:
      - ORDERS: count Order rows in window (tenant scope only).
      - DEALS_WON: count DealStageHistory rows whose target stage kind is WON
        in window; + movedByUserId when scope is USER.
      - FIRST_RESPONSE: for each HUMAN outbound reply, latency to the newest
        INBOUND before it in the same conversation; share within threshold.
        SQL with a window function or a bounded per-conversation pass over
        (tenantId, conversationId, createdAt)-indexed rows.
      - REPLIES: count OUTBOUND non-internal HUMAN rows in window;
        + senderUserId when scope is USER.
- [ ] `achieved(metric, actual, target)`: FIRST_RESPONSE -> actual >= target;
      others -> actual >= target.
- [ ] `closeDueSnapshots()`: for every tenant with active targets, for the
      period(s) that closed since the last snapshot and up to 12 back:
      upsert KpiSnapshot. Idempotent; safe to call on every tick and on boot.
- [ ] `scripts/self-check-kpi.ts` (assert-based, clone DB): period math
      (month, week, two-week boundaries), each metric against seeded
      messages/orders/stage-moves, snapshot upsert idempotency, cap
      enforcement at the API level is checked in Phase 4 manually.

## Phase 3 - Worker tick

- [ ] `scheduler.ts`: daily cron at 00:10 Jakarta ("10 17 * * *" UTC) calls
      `closeDueSnapshots()` in system context; catch-up call on boot after
      the existing boot reconnect block. Log a one-line summary (tenants,
      snapshots written) in the alert-check style.

## Phase 4 - Dashboard API (OWNER-only, Zod at the boundary)

- [ ] `POST /api/dashboard/kpi/targets` - create (validates metric/period/
      threshold combos, the 5-per-holder cap, pipeline entitlement for
      DEALS_WON).
- [ ] `PATCH /api/dashboard/kpi/targets/[id]` - edit targetValue /
      thresholdMinutes / active (never scope/metric/period - a change of
      meaning is a new KPI; document in the route).
- [ ] `GET /api/dashboard/kpi/targets` - list with holder names.
- [ ] `GET /api/dashboard/kpi/report` - per active target: live current
      period (computeActual + window end) + snapshot history (newest first).

## Phase 5 - UI

- [ ] `/dashboard/kpi` page (OWNER-only gate): report cards (current period
      progress, status, days left) + per-KPI history table + create/edit/
      deactivate forms. Reuse `usePolledApi`/`useApi` + existing card styles;
      no new component library.
- [ ] Dashboard shell nav entry "KPI" (hidden for STAFF).
- [ ] Empty state that explains the 4 metrics and scope rules.

## Phase 6 - Docs

- [ ] PRD 17 status DRAFT -> APPROVED with a dated note on approval.
- [ ] `docs/prd/README.md` index row for `17-staff-kpi.md`.
- [ ] `Changelogs.md` entry on release.
- [ ] OpenAPI: the KPI routes are dashboard BFF routes, not /api/v1 - no
      OpenAPI change; confirm `npm run check:openapi` still passes.

## Verification

1. `npx tsc --noEmit` for all apps; `npm run build`, `build:api`, admin
   build; `npm run check:encoding`.
2. `npm run check:rls`-style pass for the new tables (extend
   `scripts/self-check-rls.ts` if it enumerates tables).
3. `npx tsx scripts/self-check-kpi.ts` against the clone.
4. Manual on the clone: create tenant + staff KPIs, send messages from the
   test phone, move a deal, watch the current-period card move; run the
   snapshot function twice - identical results (idempotent).
5. Worker logs after deploy: one summary line per tick, no errors.

## Explicitly not in this plan

Per-staff order attribution, staff self-view, alerts, export, plan gating -
see PRD 17.7. If the owner vetoes PRD 17.1 decision 1 (per-staff ORDERS),
stop and re-plan Phase 1 before touching the schema.
