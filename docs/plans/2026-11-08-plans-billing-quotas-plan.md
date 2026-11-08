# Plans, Billing, and Quotas - Implementation Plan (2026-11-08)

PRD: `docs/prd/14-plans-billing-quotas.md`. This plan turns the package
model into a working commercial loop: exact credit charging, feature API
gates, a tenant "Paket & Kuota" page, manual invoices, and plan requests.

## What already exists (do not rebuild)

- `Plan` entitlement columns + admin create/edit with feature toggles.
- Admin usage metering (MAU, derived credits, staff, channels, media).
- Tenant `/api/dashboard/entitlements` + nav filtering + page guards.
- Channel creation and staff invite limits.
- Scenario engine feature gate and campaign pause on missing feature.
- The Basic catalog row.

## The gap this plan closes

1. Credits are derived from `Message` rows, which include the error
   fallback and approval follow-ups. That is not exact enough to bill or
   to stop on. Needs a charge ledger written at the charge point.
2. Credit exhaustion is not enforced; the agent keeps replying.
3. Feature APIs are open even when the page is hidden; the inbox still
   calls the pipeline endpoints.
4. No tenant-facing plan/quota page, no invoices, no upgrade request.
5. No admin billing surface.

## Constraints

- One plan per tenant. `tenantLimit` stays metadata; no account layer.
- No plan = legacy unlimited + all features.
- MAU never blocks inbound.
- No payment gateway, no auto-charge, no auto-suspend, no proration
  automation.
- Pages Router, Prisma/Postgres only, no queue. No `as` casts. Zod at every
  boundary. No em/en dashes.

## Phase 0 - Schema and migration

- [ ] `AiCreditUsage`: `tenantId`, `source` (`REPLY`, `SCENARIO_MODULE`),
      `credits`, `refId`, `note`, `createdAt`; unique
      `(tenantId, source, refId)`, index `(tenantId, createdAt)`.
- [ ] `Invoice`: tenant, `planId` nullable + `planName` snapshot, unique
      `number`, `periodStart`, `periodEnd`, `amountIdr`, `status`
      (`ISSUED`, `PAID`, `VOID`), `issuedAt`, `dueAt`, `paidAt`, `method`,
      `reference`, `note`; unique `(tenantId, periodStart)`, indexes
      `(tenantId, status)` and `(status, dueAt)`.
- [ ] `PlanRequest`: tenant, `requestedPlanId`, `note`, `status`
      (`NEW`, `CONTACTED`, `DONE`, `REJECTED`), `handledById`,
      `handledAt`; indexes `(tenantId, status)` and `(status, createdAt)`.
- [ ] `BillingSetting` singleton: bank name, account number, account
      holder, due days (default 7), grace days (default 7), `updatedById`,
      `updatedAt`. Platform table, no tenantId.
- [ ] Drop `Plan.tenantLimit` (the tenant is the billing unit).
- [ ] Relations: `Tenant.invoices`, `Tenant.planRequests`,
      `Plan.requests`, `AdminUser.handledPlanRequests`.
- [ ] Postgres sequence for invoice numbers.
- [ ] Migration backfills the current month into `AiCreditUsage` from
      `Message` (OUTBOUND/AGENT) and `ScenarioRunStep` (excluding trigger
      and end), `ON CONFLICT DO NOTHING`.
- [ ] Gate: `npm run db:generate`, migration applies on the clone, ledger
      totals equal the old derived totals for the month.

## Phase 1 - Exact credits and exhaustion

- [ ] `packages/core/src/lib/credits.ts`:
      `chargeCredits({ tenantId, source, refId, note? })` using
      `createMany({ skipDuplicates: true })`;
      `getCreditStatus(tenantId, monthStart)` summing the ledger;
      `monthStartUtc` already lives in `lib/entitlements.ts`.
- [ ] `agent-loop.ts`: before `runConversation`, read entitlements and
      credit status. If `limit !== null && used >= limit`, stand down
      (`stoodDown: true`), write one `agent.credits_exhausted` audit row
      per conversation per month (deduped in `Conversation.settings`), and
      return before any LLM call.
- [ ] `agent-loop.ts`: after `runConversation`, charge 1 with
      `source = REPLY`, `refId = triggerMessageId` (fallback: the inbound
      message id is always present on this path). If the charge write
      fails, log `agent.credit_charge_failed` and still return the reply:
      a billing write must not silence the customer. Fail open on a
      credit-check query error too, with the same audit.
- [ ] `scenario-engine.ts`: after `scenarioRunStep.create` and before
      `executeNode`, charge 1 with `source = SCENARIO_MODULE`,
      `refId = step.id`.
- [ ] Admin usage API switches credits to the ledger
      (`groupBy tenantId, source`), keeping the reply/module breakdown.
- [ ] Channel counters switch to `status = CONNECTED` in
      `getTenantUsage`, the admin usage API, and the connect guard.
- [ ] Overview "Kredit AI" reads the ledger.
- [ ] Gate: plan with 5 credits, 6 inbound turns; the 6th stands down,
      ledger has 5 rows, usage shows 5/5, one audit row, inbound still
      recorded. Replaying the same trigger does not add a row.

## Phase 2 - Feature API gates and inbox cleanup

- [ ] Add `FEATURE_DISABLED` to `ErrorCode`.
- [ ] `packages/core/src/lib/feature-guard.ts`:
      `requireFeatureApi(session, res, feature)` returns boolean and sends
      `403 FEATURE_DISABLED` with the plan name.
- [ ] Guard the 19 routes listed in the PRD (campaigns 5, scenarios 6,
      pipeline 8).
- [ ] Dashboard shell: fetch entitlements once and provide them through a
      context (`entitlements-context.tsx`) so the nav, banners, and inbox
      read the same data.
- [ ] Inbox: hide the pipeline stage badge in the conversation list and
      the stage section in contact details when `pipeline` is off.
- [ ] Gate: Basic tenant gets 403 on every feature route; inbox renders
      without stage UI and without console errors; legacy tenant keeps all
      features.

## Phase 3 - Tenant "Paket & Kuota"

- [ ] `GET/POST /api/dashboard/billing` (OWNER only): entitlements, usage,
      invoices, catalog, open plan request, bank details. POST creates a
      plan request; reject a second open request; write an `AuditLog` row.
- [ ] Extend `/api/dashboard/entitlements` with `billingOverdue` for
      OWNER only (one count query) so the shell banner needs no second
      request.
- [ ] `/dashboard/plan` page (`requireAuth({ requiredRole: "OWNER" })`):
      plan card, four usage meters, feature list, invoices + transfer
      instructions, catalog + request dialog, legacy state.
- [ ] Nav: "Paket & Kuota" in the bottom group, owner-only.
- [ ] `plan-banner.tsx` in the shell: credits 80/100, MAU 80/100, seats at
      limit, overdue invoice. Owner-only, links to the page.
- [ ] Bank details, due days and grace days come from `BillingSetting`
      (admin console), not env. When unset the page says "Hubungi admin".
- [ ] Gate: legacy state, Basic state, request flow, staff blocked from
      page and endpoint, banner appears at thresholds.

## Phase 4 - Admin billing

- [ ] `/api/admin/invoices` GET/POST/PATCH: list, create (tenant, plan,
      period, amount, due), mark paid, void. Invoice number from the
      sequence, formatted `INV-{YYYYMM}-{0001}`. Audit every action.
- [ ] `/api/admin/plan-requests` GET/PATCH: list, change status, set
      handledBy/handledAt. Audit.
- [ ] `/api/admin/billing-settings` GET/PUT: bank name, account number,
      account holder, due days, grace days. Audit.
- [ ] `/admin/billing` page: summary strip (outstanding, overdue, paid this
      month), invoice table + create dialog, "perlu ditagih" list (plan but
      no invoice for the current period), request table, and a billing
      settings panel for the bank details.
- [ ] Nav: "Tagihan" under Konfigurasi.
- [ ] Gate: create, duplicate rejected, mark paid, void, request status
      visible to the tenant.

## Phase 5 - Verification and docs

- [ ] Build admin, dashboard, api; worker type-check by running its entry
      against the generated client (tsx does not type-check, so run
      `tsc --noEmit` with the worker tsconfig if present, or a one-off
      check).
- [ ] Encoding gate.
- [ ] Live flow on the clone: legacy tenant, Basic tenant, invoice,
      request, credit exhaustion, feature 403, MAU count.
- [ ] Update the status report and tick this plan.
- [ ] Consider extending `scripts/smoke-test.ts` with entitlements and
      billing checks.

## Rollout

- One push deploys all four services; the dashboard/worker/api run
  `prisma migrate deploy` before start, so the migration lands first.
- The admin service does not run migrations itself; it may 500 for a few
  seconds until another service applies them. Do not create invoices in
  that window.
- Owner sets the three `BILLING_BANK_*` vars on `csq-dashboard` (and
  `csq-admin` does not need them).
- Assign Basic only after Phase 3 ships, otherwise the tenant loses
  campaigns/scenarios/pipeline with no page explaining why.

## Risks

- **Hard stop silences the agent.** Mitigation: owner banner, audit row,
  manual replies still work, and the plan is one assignment away. If the
  owner rejects the hard stop, Phase 1 becomes meter-only and the ledger
  still lands.
- **Ledger race overshoot** of at most concurrent turns. Visible and
  billable; documented in the PRD.
- **Feature guards break the inbox** if the pipeline surfaces are missed.
  Phase 2 includes the two known surfaces; grep again before shipping.
- **Manual billing drift**: plan assigned, no invoice. The "perlu ditagih"
  list is the control.
- **Backfill double count**: unique constraints make it idempotent.
- **Invoice numbers** have gaps on failed inserts. Acceptable; they are
  references, not accounting sequences.

## Decisions (resolved 2026-11-08)

1. Credit exhaustion: hard stop at 100%.
2. Basic MAU: unlimited (`NULL`), edits apply on the next request.
3. Basic premium features: none.
4. Bank details: admin console (`BillingSetting`), not env.
5. Due and grace: 7 + 7 days.
6. Tenant limit: dropped; the tenant is the billing unit.
