# Admin Console Plan (PRD 13)

Date: 2026-11-08
PRD: `docs/prd/13-admin-console.md` (the SaaS-operator section). The
console is a UI + BFF over the same Postgres, in the tenant dashboard's
design language, on `@csq/ui`. Every phase leaves the build green and the
stack deployable; each phase is one or more commits.

## Phase 0 - shared UI package (already approved, runs first)

Execute `docs/plans/2026-11-08-shared-ui-package-plan.md` verbatim: the
design-system layer moves to `packages/ui` so the admin console consumes
shared primitives from its first component instead of cloning them. This
is the PRD 12 plan, unchanged - listed here only to fix the order.

## Phase 1 - admin skeleton + its own auth realm (scope M)

1. Schema: `AdminUser` (id, email unique, name, passwordHash, role
   SUPERADMIN, timestamps) and `AdminActionLog` (id, adminId, action,
   targetType, targetId, before/after JSON, createdAt) - one migration.
   Platform tables: no tenantId, no tenant RLS policy (documented
   exception, PRD 13).
2. `apps/admin` workspace app: Pages Router, `@csq/core` + `@csq/ui`
   deps, its own NextAuth credentials provider against AdminUser (its own
   secret, its own cookie, its own login page), tsconfig path mappings
   like the dashboard's, `transpilePackages: [@csq/core, @csq/ui]`.
3. Shell + nav from `@csq/ui` in the tenant dashboard's visual language;
   all v1 menu slots stubbed with empty states.
4. `admin:create` CLI (tsx script) to bootstrap the first operator.
5. Deploy as the `csq-admin` Render service (standard, Singapore,
   monorepo branch): DB pair, NEXTAUTH_URL/SECRET, NODE_VERSION.
6. Acceptance: admin login works with zero tenant-credential crossover
   (a tenant session cookie does nothing against admin routes), the
   shell renders from `@csq/ui`, the service is live.

## Phase 2 - tenants: list, detail, create, suspend/activate (scope M-L)

1. Schema: `TenantStatus` enum + `Tenant.status` (default ACTIVE),
   migration + the RLS-neutral column.
2. BFF routes (all admin-session-only): list with KPIs + search/filter;
   read-only detail drill-down; create tenant (name, slug, owner email,
   owner password handoff) reusing the tenant-creation logic path;
   suspend/activate writing AdminActionLog.
3. Core enforcement (the cross-service half): a `tenantActive` guard the
   agent loop and the dashboard session check call - suspended means no
   LLM turns and tenant users see a suspended error. The worker
   disconnects suspended tenants' Baileys sockets via ChannelCommand;
   activation reconnects from saved creds.
4. Acceptance: creating a tenant from admin makes a working tenant login
   possible; suspending cuts its agent replies + locks its dashboard
   while inbound keeps ingesting; activating restores everything without
   a QR re-scan.

## Phase 3 - channel fleet + operations (scope M)

1. Channel fleet: cross-tenant list (status, lease holder, last
   activity), operator force-reconnect/disconnect actions as
   ChannelCommand rows - no new machinery, the worker already executes
   them.
2. Operations: SystemLock table view with lease age; OutboundMessage
   queue view with a requeue action (FAILED -> QUEUED);
   ChannelCommand queue view; per-source sync freshness.
3. Acceptance: an admin-forced reconnect produces the same command ->
   worker -> QR/result flow as the tenant dashboard's own connect.

## Phase 4 - audit, API keys, operators (scope M)

1. Global audit log: cross-tenant AuditLog reader with tenant / action /
   date filters; AdminActionLog view.
2. API keys: cross-tenant list + revoke (deferred register item 3 closes
   here - tenant-side minting already exists).
3. Operator management: invite a second admin (one-time password
   handoff), remove operators; every action in AdminActionLog.
4. Acceptance: every admin mutation of the phase is visible in the
   AdminActionLog with actor + before/after.

## Phase 5 - plans + usage metering (scope M)

1. Schema: `Plan` (name unique, priceIdr Int display-only, limits JSON,
   timestamps - a platform table, no tenantId) + `Tenant.planId`
   nullable FK (SetNull backstop; app logic blocks deleting assigned
   plans). One migration.
2. Plan limits Zod schema - `agentRepliesPerMonth`, `messagesOutPerMonth`,
   `channels`, all nullable (null = unlimited) - validated at every
   boundary.
3. BFF routes, operator-only, every mutation audited in AdminActionLog:
   plan list/create/update, assign plan to tenant.
4. Metering: monthly aggregation over EXISTING rows at read time - no
   counter tables, no write-path overhead. Per tenant per calendar
   month: outbound total (direction OUTBOUND), agent replies (OUTBOUND +
   senderType AGENT), inbound total, active channels, MediaAsset storage
   bytes; each compared against the assigned plan's limits.
5. Admin UI: the "Paket & Penggunaan" menu - plan cards + editor, tenant
   assignment, usage table (tenant, plan, agent replies, outbound, % of
   limit, over-limit badge).
6. Acceptance: usage counts match the clone's real message rows;
   a tenant whose plan limits sit below its actual usage shows the
   over-limit badge; every plan mutation lands in AdminActionLog; any
   pricing discussion cites CURRENT official WhatsApp/LLM costs, never
   memory.

## Verification per phase

`npm run build` (+ `build:api`), all self-check suites, the encoding
guard, the live smoke suite extended phase by phase with an admin section
(admin login, tenant list, a suspended-tenant 403 check), and - for the
schema phases - the migration applying cleanly on the clone at deploy.

## Cost and risk

- One additional Render service (fourth total; owner-accepted per PRD 13).
- Suspension is the riskiest write in the console: the enforcement matrix
  (dashboard lockout, agent stand-down, socket disconnect, ingest
  continues) is specified in the PRD and gets its own smoke checks.
- The admin realm is only as safe as operator credentials: bcrypt +
  rate-limited login + the same timing-equalization the token realm uses.
