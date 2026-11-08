# 14. Plans, Billing, and Quotas (owner direction 2026-11-08)

Status: **proposed**. The model and metering exist; billing, tenant-facing
quota visibility, and exact credit enforcement do not. Execution plan:
`docs/plans/2026-11-08-plans-billing-quotas-plan.md`. Open decisions at the
end must be confirmed before Phase 1 starts.

## Commercial model

- One plan per tenant, billed monthly in IDR. A tenant is the billing unit:
  one business, one workspace.
- Billing is **manual** in this stage: the operator issues an invoice, the
  tenant pays by bank transfer, the operator marks it paid. No payment
  gateway, no card storage, no auto-charge.
- **The tenant is the billing unit.** A plan is assigned per tenant, so
  every package includes exactly one workspace. `tenantLimit` is dropped
  (2026-11-08): a configurable limit that can never be enforced is dead
  config. Multi-workspace accounts are a separate architecture phase, only
  when a real customer needs more than one business under one
  subscription.
- A tenant with **no plan is legacy**: unlimited and every feature. This
  keeps existing tenants working until the operator assigns a package.
- Plan changes take effect **immediately** for entitlements. Billing is
  manual, so proration is the operator's call: they void and reissue the
  invoice, or edit the amount when creating it. No automatic proration.
- Any actual pricing decision must first verify current official WhatsApp
  API and LLM provider costs against live documentation - repo rule;
  platform pricing moves fast and must never be quoted from memory.

## Package catalog

`Plan` columns (implemented 2026-11-08):

| Column | Meaning | NULL |
|---|---|---|
| `name` | Unique package name | - |
| `priceIdr` | Monthly price, display only | - |
| `aiCreditsPerMonth` | AI credits per month | Unlimited |
| `mauLimit` | Monthly active users | Unlimited |
| `staffLimit` | STAFF seats, owner excluded | Unlimited |
| `channelLimit` | Connected WhatsApp channels the tenant may run | Unlimited |
| `features` | Premium keys: `campaigns`, `scenarios`, `pipeline` | Empty = core only |

Current catalog entry (created 2026-11-08):

```
Basic | Rp 500.000 | 15.000 credits | MAU uncapped | 1 staff | 1 channel | no premium features
```

MAU `NULL` means unlimited, and a plan edit takes effect on the next
request: the tenant page reads the current plan row, never a cached copy.

## Entitlements and metering

### AI credits

Definition: **1 credit per AI-generated reply, plus 1 credit per executed
scenario module, excluding the `trigger` and `end` nodes.** Scenario sends
are `senderType SCENARIO`, so a scenario AI module is charged once as a
module and never again as a reply.

Charging points:

- **Reply**: in `runAgentReply` after `runConversation` returns, charge 1
  with `source = REPLY` and `refId = triggerMessageId`. The LLM cost was
  already paid at that point, even if the WhatsApp send later fails or the
  24h window is closed.
- **Scenario module**: when the engine creates a `ScenarioRunStep`, charge
  1 with `source = SCENARIO_MODULE` and `refId = step.id`, before executing
  the node. Failed steps are still charged: the work ran.
- Not charged: the error fallback, approval follow-ups, the truncated
  "still processing" message, campaign sends, human replies. They are
  outbound agent-adjacent messages but not AI replies.

**Why a ledger, not a derived count.** The current metering counts every
outbound `Message` with `senderType AGENT`, which includes the error
fallback and approval follow-ups. That is acceptable for a display metric
and wrong for billing or a hard stop. `AiCreditUsage` is written at the
exact charge point, is idempotent per `(tenantId, source, refId)`, survives
message deletion, and gives the invoice a paper trail. This supersedes the
"no counter tables" note in PRD 13.

Exhaustion policy (decision needed): recommended **hard stop at 100%**.
Before calling the LLM, `runAgentReply` sums the month's credits. At or
above the limit it stands down exactly like a human-assigned conversation:
no LLM call, no reply, inbound still ingested. It writes one audit row
`agent.credits_exhausted` per conversation per month (deduped through
`Conversation.settings`), and the dashboard shows an owner banner. Staff
can still reply manually. A grace percentage or overage billing is the
alternative; it needs a billing rule and is not free.

Concurrency: two turns in different conversations can both pass the
pre-check and overshoot by at most the number of concurrent turns. The
ledger records the real usage, so the overshoot is visible and billable.
This is deliberate: an atomic counter would need a second source of truth
and a monthly reset job. If exactness becomes a contract term, add a
counter then, not now.

### MAU (monthly active users)

Definition: distinct `Conversation.customerPhone` with at least one inbound
`Message` in the calendar month (UTC). New and returning senders both
count; the same phone counts once, across channels.

MAU is a **pricing meter, not a gate**. Exceeding it must never drop or
block an inbound customer message: inbound ingestion is the product's
promise. At 80% and 100% the owner sees a banner and the tenant page shows
the overage; the operator can issue a custom invoice or move the tenant to
a higher package. No automatic overage billing in this stage.

### Staff and channels

- `staffLimit`: STAFF users, owner excluded. Invite is blocked at the
  limit (implemented).
- `channelLimit`: **CONNECTED channels only**; disconnected rows do not
  count. Connecting a channel (new or existing) is blocked when the
  connected count is at the limit and the target is not already connected.
  Disconnecting is always allowed. Reconfiguring an already-connected
  channel is allowed because it is already in the count (implemented;
  connected-only counting lands with Phase 1).

### Premium features

Catalog: `campaigns`, `scenarios`, `pipeline`. A plan without the key has
the feature disabled:

- Dashboard: nav entry hidden, page SSR-redirected to `/dashboard`.
- API: every feature route returns `403 FEATURE_DISABLED` (Phase 2).
- Worker: scenario runs fail with "Skenario tidak aktif di paket tenant";
  due campaigns are paused with an audit row (implemented). In-flight
  campaign messages already queued still drain (bounded work).
- Inbox: the pipeline stage badge and the stage section in contact details
  must hide when `pipeline` is off (Phase 2), otherwise the panel shows
  403 errors.

## Billing

### Invoices

`Invoice`: tenant, plan snapshot (`planId` nullable + `planName`), number,
period start/end, amount, status, issued/due/paid timestamps, method,
reference, note.

- Statuses: `ISSUED`, `PAID`, `VOID`. The operator creates an invoice
  already issued; there is no draft step.
- Number: `INV-{YYYYMM}-{sequence}`, generated from a Postgres sequence,
  unique. It is the bank transfer reference.
- Period: one invoice per tenant per `periodStart` (unique), so a double
  click cannot bill twice.
- Amount: defaults to the plan price, editable by the operator (discount,
  proration, custom deal).
- Due: `BillingSetting.dueDays` after issue (default 7), editable per
  invoice.
- Payment instructions: bank name, account number, account holder, due
  days and grace days are edited in the admin console (`BillingSetting`,
  one platform row). No env vars. When unset, the tenant page says
  "Hubungi admin" instead of showing empty bank fields.
- Overdue is **computed** (`status = ISSUED && dueAt < now`), never a
  stored status. No auto-suspend, no dunning. The operator suspends
  manually after `BillingSetting.graceDays` (default 7) using the existing
  tenant suspension.
- No PDF in this stage. The page shows the invoice detail and the transfer
  instructions.

### Plan requests

`PlanRequest`: tenant, requested plan, optional note, status
(`NEW`, `CONTACTED`, `DONE`, `REJECTED`), handled by/at.

- The tenant page has one "Ajukan paket" action per available plan. Only
  one open request (`NEW` or `CONTACTED`) per tenant; the API rejects a
  second one.
- The admin billing page is the inbox: list, mark contacted, done, or
  rejected. No email notification in this stage.
- Requesting a plan does not change entitlements. The operator assigns the
  plan after payment, which is the existing manual assignment.

## Tenant dashboard: Paket & Kuota

Route `/dashboard/plan`, nav label "Paket & Kuota", **OWNER only** (nav
hidden for STAFF, page redirects). Read-only except the plan request.

Sections:

1. **Plan aktif**: name, monthly price, status (`Aktif` / `Tanpa paket`),
   included feature chips. Legacy tenants see "Tanpa paket - semua fitur
   aktif, tanpa batas".
2. **Pemakaian bulan ini**: four meters with used / limit and a progress
   bar: Kredit AI (with the reply/module breakdown), MAU (note "pengirim
   unik"), Staf, Saluran. Warn at 80%, bad at 100%. A limit of NULL shows
   "Tanpa batas" and no bar. Month start is shown.
3. **Fitur**: included and not included, from the catalog. Disabled
   features are not links; the note explains that the package controls
   them.
4. **Tagihan**: unpaid invoices first with transfer instructions, then
   history (period, amount, status, due, paid). Empty state when none.
5. **Paket lain**: the catalog minus the current plan, each with price,
   limits, features, and an "Ajukan paket" dialog (note optional). If an
   open request exists, show its status instead of the buttons.

Owner banners in the dashboard shell (not on the plan page only):

- AI credits >= 80% (warn), >= 100% (bad, agent stopped).
- MAU >= 80% (warn), >= 100% (bad, overage).
- Staff or channels at the limit (warn).
- Overdue invoice (bad).

Banners link to `/dashboard/plan`. They are owner-only; STAFF see nothing
about billing.

## Admin console

New page `/admin/billing` (nav "Tagihan"):

1. **Ringkasan**: outstanding amount, overdue count, paid this month.
2. **Invoice**: table (number, tenant, period, amount, status, due,
   actions). Create dialog: tenant, plan (defaults the amount), period
   month, amount, due date. Actions: mark paid (method + reference), void.
3. **Perlu ditagih**: tenants with a plan but no invoice for the current
   period. This is the operator's monthly checklist.
4. **Permintaan paket**: tenant, requested plan, note, status, actions.

All actions are audited through `AdminActionLog`. The plan editor and
usage view stay on `/admin/plans`; the billing page links to it.

## Enforcement matrix

| Entitlement | Dashboard UI | API | Worker/runtime |
|---|---|---|---|
| AI credits | meters, banner | pre-check in agent turn (Phase 1) | charge ledger; stand down at limit |
| MAU | meter, banner | none, never blocks inbound | none |
| Staff | team seat count | invite blocked (done) | n/a |
| Channels | connected channel count | connect blocked at the limit (done) | n/a |
| Features | nav, page guard, inbox stage UI | `FEATURE_DISABLED` on every route (Phase 2) | scenario fail, campaign pause (done) |
| Invoices | invoice section, overdue banner | OWNER-only read | no auto-suspend |

Feature routes to guard in Phase 2:

- campaigns: `index`, `[id]`, `[id]/[action]`, `[id]/runs`, `preview`.
- scenarios: `index`, `[id]`, `[id]/activate`, `[id]/pause`,
  `[id]/runs`, `team`.
- pipeline: `index`, `deals/index`, `deals/[conversationId]`, `funnel`,
  `stages/index`, `stages/[id]`, `stages/reorder`.

## Security and audit

- Tenant billing endpoints are OWNER-only, server-side. STAFF must not see
  invoices or amounts.
- Every query is tenant-scoped from the session, never from the body.
- Bank details are server env, never client env.
- Admin invoice and request actions write `AdminActionLog`; credit
  exhaustion writes `AuditLog`; plan assignment already writes both.
- Invoice numbers are generated server-side; the client cannot choose one.

## Data model changes

- `AiCreditUsage` (`tenantId`, `source` REPLY/SCENARIO_MODULE, `credits`,
  `refId`, `createdAt`) with unique `(tenantId, source, refId)` and index
  `(tenantId, createdAt)`.
- `Invoice` as above, unique `(tenantId, periodStart)`, unique `number`,
  indexes `(tenantId, status)` and `(status, dueAt)`.
- `PlanRequest` as above, indexes `(tenantId, status)` and
  `(status, createdAt)`.
- Postgres sequence for invoice numbers.
- `BillingSetting` (singleton): bank name, account number, account
  holder, due days, grace days, `updatedById`, `updatedAt`. Platform
  table, no tenantId.
- Drop `Plan.tenantLimit`.
- Relations: `Tenant.invoices`, `Tenant.planRequests`,
  `Plan.requests`, `AdminUser.handledPlanRequests`.
- Migration backfills `AiCreditUsage` for the **current month** from
  `Message` (OUTBOUND/AGENT) and `ScenarioRunStep` (excluding trigger/end)
  so usage does not reset at deploy. Unique constraints make it
  idempotent.

## Resolved decisions (2026-11-08)

1. **Credit exhaustion**: hard stop at 100%. No grace, no overage billing
   in this stage.
2. **Basic MAU**: unlimited (`NULL`). Plan edits apply on the next request.
3. **Basic premium features**: none.
4. **Bank details**: edited in the admin console, not env.
5. **Due and grace**: 7 days due, 7 days grace before manual suspension.
6. **Tenant limit**: dropped. The tenant is the billing unit; accounts are
   a separate phase.

## Out of scope (do not build)

Payment gateway, card storage, auto-charge, auto-invoicing, proration
automation, dunning, automatic suspension, PDF invoices, credit top-ups,
overage billing, email or WhatsApp billing notifications, multi-workspace
accounts, self-serve plan changes, tax handling.

## Acceptance criteria

- A Basic tenant sees plan, price, four usage meters, features, invoices,
  and the catalog; STAFF cannot open the page or call the endpoint.
- A tenant with no plan sees the legacy state, not zeros or an error.
- Credits: at the limit, the agent stops before the LLM call, inbound
  still lands, one audit row per conversation per month, banner shows.
- Ledger: each AI reply and each scenario module has exactly one row;
  retries and double drains do not double charge.
- MAU: two inbound from the same phone and one from another phone show 2.
- Channel limit counts CONNECTED channels only: a disconnected row does
  not block a new connection, and reconnecting an already-connected
  channel is never blocked.
- Feature APIs return `403 FEATURE_DISABLED`; the inbox pipeline surfaces
  are hidden.
- Admin creates an invoice, the tenant sees it with transfer instructions,
  marks it paid, the tenant sees PAID; void works; a second invoice for the
  same tenant and period is rejected.
- Plan request: tenant submits, admin sees it, status changes, tenant sees
  the status, a second open request is rejected.
- Overdue invoice produces an owner banner; nothing is suspended
  automatically.
