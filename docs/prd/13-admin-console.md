# 13. Platform Admin Console (owner decision 2026-11-08)

This is the SaaS-operator section that PRD file 04 and the enterprise plan
required before `apps/admin` could be built. It defines the operator
console for THIS installation's multi-tenancy (the in-scope "logical
multi-business support"), not fleet management across installations and
not billing - subscription/payment processing stays out of scope
(file 04) until an explicit later decision.

## Who it is for

The platform operator: the person running this CSQ installation. Admin
users are a SEPARATE realm from tenant users - a dedicated `AdminUser`
table, its own login, its own session. A tenant credential can never
reach an admin route and vice versa. The first admin is created by CLI
(`admin:create` script); further admins are invited from the console.

## v1 menus

1. **Ringkasan (Overview)** - platform KPIs: tenants (total / active /
   suspended), users, conversation + message volume (24h / 7d), channels
   by status, outbox depth + recent failures, command queue, tick
   freshness, lease states. This is the operations VIEW - the alerting
   half of deferred item 6 remains its own cutover-triggered bundle.
2. **Tenant** - list (search, status filter, health indicators), read-only
   detail drill-down (users, agents, channels, campaigns, data sources,
   media usage), create tenant (provisions the tenant + its owner user),
   suspend / activate with the semantics below.
3. **Saluran (Channel fleet)** - every channel across tenants with
   session status and lease holder; operator actions reuse the existing
   machinery: force-reconnect and disconnect are ChannelCommand rows the
   worker already executes.
4. **Operasional (Operations)** - SystemLock view (all leases with age),
   the OutboundMessage queue with a requeue action for FAILED sends,
   the ChannelCommand queue, per-source Sheets-sync freshness.
5. **Audit** - the global (cross-tenant) AuditLog with filters, plus the
   AdminActionLog of operator actions.
6. **Kunci API (API keys)** - cross-tenant key list + revoke. Deferred
   item 3 lands here (the tenant-side mint routes already exist).
7. **Admin** - invite and remove operator accounts.
8. **Paket & Penggunaan (Plans & Usage)** - plan list/create/edit,
   per-tenant plan assignment, and the monthly usage table against plan
   limits with over-limit badges (see the monetization section below).

## Suspension semantics (the core product decision)

New `TenantStatus` enum (`ACTIVE` default, `SUSPENDED`):

- **Suspended**: tenant users are locked out (login blocked; live
  sessions get a clear suspended error), the agent loop stands down (no
  LLM turns), the worker disconnects that tenant's Baileys sockets,
  scheduled campaigns pause automatically. Inbound WhatsApp messages are
  STILL ingested - data is never lost, the agent simply does not answer.
- **Activated**: everything above reverses; channels reconnect from
  saved creds (no QR re-scan).
- Every lifecycle action writes an AdminActionLog row (actor, target,
  before/after).

## Plans, billing, and quotas

The package catalog, entitlement model, metering, invoices, plan requests,
and quota enforcement are specified in `14-plans-billing-quotas.md`. The
console owns the operator side: the plan editor on `/admin/plans` and
billing on `/admin/billing`. The tenant side owns `/dashboard/plan`. Do not
duplicate the commercial rules here.

## Architecture and standardization

- `apps/admin`: Next.js Pages Router, UI + BFF - built on `@csq/ui` (the
  shared package MUST be extracted first: the approved PRD 12 plan is
  Phase 0 of the admin plan - the admin console is its third consumer and
  must not clone a single component). **Amended 2026-11-08 (owner
  direction): the console has its own "Ledger" visual direction** - warm
  paper, hairline rules, mono numerals, one signal color - ported from
  the approved reference at `docs/assets/admin-console-reference`. It
  shares primitives and tokens with the tenant dashboard but not its
  card-heavy layout: the console is a dense operator ledger, the
  dashboard is a product UI.
- Admin data access lives IN `apps/admin` (platform-scoped queries over
  `@csq/core/lib/db`), deliberately NOT in core - tenant apps must never
  be able to import operator functions. Only cross-service domain rules
  (the suspension stand-down the worker must enforce) live in core.
- Platform tables (`AdminUser`, `AdminActionLog`) carry NO tenantId and
  are the documented exception to the every-table-has-tenant_id rule.
- Deployed as its own Render service (`csq-admin`): DB pair + its own
  NEXTAUTH_URL/SECRET + Node version. No LLM env, no WhatsApp env, no
  socket ownership - the admin console never holds a session.
- Admin writes are limited to: tenant lifecycle (create / suspend /
  activate), channel commands, outbox retries, key revocation, operator
  invites. Everything else is read-only.

## Explicitly deferred beyond v1

Payment gateway, subscriptions, auto-invoicing and dunning (Stage 3),
impersonation ("login as tenant", needs its own audited design),
announcement broadcasting, and anything across multiple installations.
Quota enforcement and manual invoicing shipped with PRD 14 and are no
longer deferred (amended 2026-11-09).

## Execution

Phased plan, each phase deployable, gates identical to every prior phase:
`docs/plans/2026-11-08-admin-console-plan.md`. Phase 0 is the approved
shared-UI extraction. Deployment adds a fourth Render service - a third
cost line the owner accepts by approving this PRD.
