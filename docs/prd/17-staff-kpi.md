# 17. Staff KPI & Performance Report (owner request 2026-11-10)

Status: **APPROVED 2026-11-10 ("Okay continue") - implemented 2026-11-10.**
Implementation record: Phases 0-6 of
`docs/plans/2026-11-10-staff-kpi-plan.md` shipped on `monorepo`
(Phase 0 reply-as-takeover `317a344`; KPI core, schema, APIs, page, and
scheduler tick in the follow-up commits). Verification: `npm run check:kpi`
period-math asserts (Jakarta day/week/two-week/month + ISO-year edge),
typecheck, all builds, encoding gate; snapshot closing is idempotent and
runs daily at 00:10 Jakarta plus a boot catch-up in the worker.

The tenant OWNER defines performance KPIs for the staff they add, and for
the tenant as a whole, over day / week / 2-week / month periods. The
system measures actuals from data it already records, reports progress for
the current period, and keeps a per-period history (Nov, Oct, ...) so
performance is comparable over time.

## 17.1 What is being measured

The tenant's work is already fully recorded: every Message row (direction,
senderType, senderUserId, createdAt), every Order row (createdAt), and every
pipeline stage move (DealStageHistory, with movedByUserId for human moves and
movedByAgentId for AI moves). KPIs are computed from these records. Nothing is
self-reported by staff.

Four metrics:

| Metric | Tenant scope | Staff scope | Definition |
|---|---|---|---|
| `ORDERS` | yes | **not offered** | Count of Order rows created in the period. |
| `DEALS_WON` | yes | yes | Count of pipeline moves into a WON-kind stage in the period. Staff scope: only moves made by that user (`movedByUserId`). |
| `FIRST_RESPONSE` | yes | yes | Share (%) of first human replies that arrived within the threshold minutes of the customer message that triggered them. Staff scope: only replies by that user. |
| `REPLIES` | yes | yes | Count of human outbound messages (non-internal) in the period. Staff scope: only that user's. |

Decisions baked in (veto in review if wrong):

1. **No per-staff ORDERS KPI.** Orders are created by the AI tool only in
   AI-handled chats (the agent stands down when a human owns the
   conversation), so "the staff member handling the chat at order time" is
   always empty. Any per-staff order attribution would be fiction. The honest
   per-staff "closed" metric is `DEALS_WON` (the staff member moved the deal
   to a WON stage). Orders remain a tenant-wide metric.
2. **`FIRST_RESPONSE` is a percentage against a threshold, not a median.**
   Config: threshold minutes X + target percent (e.g. "90% of chats answered
   within 5 minutes"). A median hides the customer who waited an hour.
3. **Only human activity counts for staff KPIs.** AI replies, AI orders, and
   AI stage moves never credit a staff member. Tenant-scope totals include
   AI work (a tenant KPI measures the business, a staff KPI measures the
   human).
4. **Chats the human never answered do not count against `FIRST_RESPONSE`.**
   AI-handled chats are invisible to the staff responsiveness KPI; only
   conversations where a human actually replied are measured.
5. **The response clock is the customer's clock.** FIRST_RESPONSE measures
   inbound arrival -> first human reply. The takeover rule (PRD 03 amendment
   2026-11-10: a human reply takes over the conversation immediately) makes
   "replied" and "assigned" the same event for AI-handled chats - once a
   staff member replies, the chat is theirs and the AI stops, so the latency
   measured is genuinely the human's response time with no AI interference
   after it.

## 17.2 KPI targets (configuration)

One `KpiTarget` row per KPI:

- `scope`: `TENANT` or `USER` (staff member of this tenant).
- `metric`: `ORDERS` | `DEALS_WON` | `FIRST_RESPONSE` | `REPLIES`.
- `period`: `DAY` | `WEEK` | `TWO_WEEK` | `MONTH`.
- `thresholdMinutes`: for `FIRST_RESPONSE` only.
- `targetValue`: number - the count target, or the percent target (0-100) for
  `FIRST_RESPONSE`.
- `active`: boolean. Deactivating hides a KPI from the report; it never
  deletes history.

Rules:

- OWNER-only: only the tenant OWNER creates, edits, deactivates KPIs.
- Max 5 active KPI targets per holder (the tenant, or each staff member).
  The create/update API enforces the cap.
- `DEALS_WON` requires the pipeline feature (plan-gated); the API rejects it
  for tenants without the entitlement.
- No plan gating of the KPI feature itself in v1 (all plans). Revisit as a
  differentiator later.

## 17.3 Periods

Calendar periods computed in **Asia/Jakarta (WIB)** - the operating timezone
of the target market; UTC would shift "per day" by 7 hours:

- `DAY`: calendar day.
- `WEEK`: Monday-Sunday.
- `TWO_WEEK`: 1st-14th and 15th-end of month.
- `MONTH`: calendar month.

`periodStart`/`periodEnd` are stored as UTC instants; `periodKey` is a
sortable string per type (day `2026-11-10`, week `2026-W45`, two-week
`2026-11-H1/H2`, month `2026-11`). All snapshots of one target share the
format, so string order equals chronological order.

## 17.4 History (snapshots)

Owner decision 2026-11-10: history is in scope, not deferred.

- At each period close, the worker writes one `KpiSnapshot` row per active
  KpiTarget: actual value, the target value as it was then (denormalized -
  later target edits never rewrite history), achieved flag, and the metric
  parameters needed to interpret it (threshold, counts checked).
- Snapshot writing is an idempotent upsert on (target, periodKey): a missed
  tick, a deploy gap, or worker downtime is healed by the next run. First run
  backfills up to 12 prior periods from raw data, so a tenant that starts
  using KPIs in November sees Oct, Sep, ... immediately.
- Deleting a KPI target is not possible; deactivation keeps its snapshots.
- The current period is NEVER snapshotted - it is computed live so the report
  always reflects the moment, and the snapshot at close is authoritative.

## 17.5 Report

A `/dashboard/kpi` page, OWNER-only:

- Per active KPI: current-period actual vs target, progress percent, status
  (achieved / on track / behind), and days left in the period.
- Per KPI history: one row per closed period (periodKey, actual, target,
  achieved) - the "KPI for Nov, Oct, ..." timeline.
- KPI management lives on the same page (create, edit target, deactivate).

## 17.6 Security

- Both new tables carry `tenantId` from day one; all queries are
  tenant-scoped and RLS policies ship in the migration (PRD 16 SEC-1
  pattern).
- All KPI APIs are OWNER-role-gated and Zod-validated at the boundary.
- KPIs never expose message content - only counts and latencies.

## 17.7 Out of scope v1

- Staff seeing their own KPIs (self-view dashboard).
- KPI alerts / notifications when a staff member is behind.
- CSV export, cross-tenant benchmarking, editable snapshots.
- Per-staff order attribution (see 17.1 decision 1).
- Target-value history edits: changing a target affects the current period
  forward; closed-period snapshots keep their own copy.
