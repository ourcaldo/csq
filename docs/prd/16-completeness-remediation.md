# 16. Completeness Remediation (owner direction 2026-11-09)

Status: **APPROVED - implement every item below.** PRD 15 (multi-channel) is
excluded by owner direction. This file is the authority for the remaining
gaps found in the 2026-11-09 full PRD and plan audit.

## Why this PRD exists

PRD 09 is complete. The audit of PRDs 01-14 and their plans found remaining
gaps in three classes:

1. Security and correctness defects in shipped code.
2. PRD-required features that were never built or are only partial.
3. Documents that no longer match the code.

This PRD closes all three. It does not reopen completed PRD 09 work.

## How to read this file

- IDs are stable. Commits and verification notes cite them.
- Priority: P0 ships first, P1 next, P2 last. DOC items can ship alongside
  any batch.
- Acceptance is testable. "Build passes" is assumed for every item and is
  not repeated.
- All work happens on the `monorepo` branch and the clone database. The
  production cutover remains frozen.

## Non-goals

- PRD 15 multi-channel. Not scheduled.
- Multi-business per user (PRD 05 22A.1). Explicitly out of scope for the
  HackFest MVP.
- The PRD 04 out-of-scope list (Shopee, Tokopedia, Instagram, full
  accounting, autonomous refunds, arbitrary DB connectors, website chat,
  Telegram, Messenger).
- Payment-gateway refunds. Refunds in this PRD are recorded and approved
  in CSQ; no money movement integration is added.
- Any production deploy, env change, or cutover action.

## P0 - Security and tenant isolation

| ID | Requirement | Acceptance |
|---|---|---|
| SEC-1 | Activate RLS as the second tenant layer. Provision a non-owner DB role, add a migration that runs `ALTER TABLE ... FORCE ROW LEVEL SECURITY` for every tenant-owned table, and wrap tenant-scoped Prisma work in a transaction that calls `set_config('app.current_tenant_id', ..., true)` on the same connection. Do not enable FORCE while the app still connects as the table owner. | With the app role, a query for tenant A returns zero rows when the session context is tenant B. Cross-tenant smoke check added. Document the role and connection string in the env examples. |
| SEC-2 | Gate every mutating import and Sheets route to OWNER: `api/import/excel/confirm.ts`, `api/import/sheets/{auth,callback,connect,confirm,sync}.ts`. STAFF receives 403. | STAFF session gets 403 on each route; OWNER still succeeds; attempts are audited. |
| SEC-3 | Enforce the PRD 15.9 page gate: configuration pages require OWNER (`agents`, `products`, `inventory`, `orders`, `knowledge`, `memory`, `settings`, `sources`, `data`), while inbox stays open to OWNER and STAFF. Use `withAuth` with `requiredRole: "OWNER"`, not client-side hiding. | STAFF is redirected or shown the forbidden state on each config page; inbox still renders. |
| SEC-4 | Complete suspension semantics. A shared `tenantActive(tenantId)` guard blocks: campaign fire and delivery, scheduler session-close sends, non-text courtesy sends, scenario runs, `/api/v1` token and refresh, and tool execution. Dashboard SSR pages show a suspended page for live sessions; login returns a distinct suspended error. On suspend, ACTIVE campaigns move to PAUSED. Baileys sockets stay connected so inbound is still ingested, but all outbound and LLM turns are suppressed; reactivation needs no QR rescan. | Suspended tenant: inbound rows still appear, no outbound rows, no LLM calls, API token mint returns `TENANT_SUSPENDED`, campaigns are PAUSED. Reactivated tenant resumes without QR. |
| SEC-5 | Harden the admin realm: per-IP rate limit on admin login, dummy bcrypt compare for unknown emails, a distinct cookie name, an `AdminUser.role` enum defaulting to `SUPERADMIN`, and a one-time password flow that never echoes the password. | Login is rate-limited and timing-equalized; cookie name differs from the dashboard; `create-admin` reads the password without echo; role is present in the schema. |

## P0 - Correctness and data integrity

| ID | Requirement | Acceptance |
|---|---|---|
| COR-1 | Make campaign delivery idempotent. Add `SENDING` to `CampaignMessageStatus`; claim each row with `updateMany({ where: { id, status: "PENDING" }, data: { status: "SENDING" } })` before sending; reset stale `SENDING` rows at tick start; keep the SystemLock. | A crash between send and mark does not resend on the next tick. A test simulates a claim collision and asserts one send. |
| COR-2 | Campaign edit must resolve the content snapshot exactly like create: `sendKind`, `metaName`, `metaLanguage`, body, images. Switching a DRAFT or PAUSED campaign to a Meta template must persist. | Edit a campaign to a Meta template, reload, and see the template fields persisted. |
| COR-3 | Capability UI must reflect effective permissions. The agents list returns tool summaries plus overrides; the card falls back to `defaultPermission` when no override exists. | `product.read` renders ON for a new agent; toggling it OFF persists an override; the runtime and UI agree. |
| COR-4 | Credit meters must read the `AiCreditUsage` ledger, not derived message counts. Keep message and scenario counts as activity metrics, but the plan page, quota ring, and entitlements endpoint use ledger totals. | Displayed credits equal the sum of ledger debits for the month; the hard stop and the display never disagree. |
| COR-5 | Make the "one open plan request" guard race-safe with a partial unique index on open statuses or a transaction plus advisory lock. | Two concurrent POSTs produce one open request and one validation error. |
| COR-6 | Audit a credit-check failure. When the ledger check fails open, write `agent.credit_check_failed` with the tenant and conversation. | A forced ledger failure produces the audit row and the agent still answers. |
| COR-7 | Seed or migrate the Basic plan so a fresh database is reproducible. | A fresh clone has the Basic plan row after seed; the plan page shows it. |

## P1 - Missing PRD features

| ID | Requirement | Acceptance |
|---|---|---|
| FEA-1 | Knowledge document upload. Accept PDF and DOCX, extract text server-side, store it as `Knowledge.content`, and keep `sourceName` plus `mimeType`. Enforce a size limit and audit the upload. Manual text entries keep working. | Upload a PDF and a DOCX; the extracted text is searchable by `knowledge.search`; the source name is visible in the dashboard. |
| FEA-2 | Refund approval. Add a `Refund` model linked to `Order`, an `order.refund` tool with `allowed: false, requiresApproval: true`, an approval execution that marks the refund and order status, and audit before/after. No payment gateway. | Customer asks for a refund; the agent creates a pending approval; OWNER approves; the order and refund records update and the audit trail shows both values. |
| FEA-3 | Support ticket. Add a `SupportTicket` model, a `support.create_ticket` tool, tenant scoping, audit, and a dashboard list with status and detail. | The agent creates a ticket from a conversation; it appears in the dashboard; STAFF can read it; only OWNER can close it. |
| FEA-4 | Agent delete. Add `DELETE /api/dashboard/agents/[id]` for DRAFT and PAUSED agents only, with a confirm dialog and audit. ACTIVE agents must be paused first. | Deleting a DRAFT agent removes it; deleting an ACTIVE agent returns a validation error. |
| FEA-5 | Team lifecycle. Replace the temp-password response with an email invite containing a one-time token (7-day expiry) and a set-password page. Add remove member and change role, both OWNER-only, with a last-owner guard and audit. | Invite email arrives; the token sets a password once; removing a member revokes access; demoting the last OWNER is rejected. |
| FEA-6 | Inbox completeness. Add a staff/agent assignment picker (reassignment audited), a channel badge per conversation, and approvals history tabs (pending, approved, rejected) with the existing PATCH. | A conversation can be assigned to a named staff member or the AI agent; the badge shows the channel; approvals history shows all three states. |
| FEA-7 | Dashboard completeness. Overview adds active agents, channel status, source health, and the last 10 agent actions. Products show a stock column from Inventory. Sources show sync history from a new `SyncLog` row written by each sync. Memory shows its source. Activity renders expandable before/after and filters by agent, action, and date. | Every listed element is visible with real data; activity filters narrow the list; sync history shows at least the last run per source. |
| FEA-8 | Data authority confidence. Add a `confidence` value to `InventorySnapshot`, set it on ingestion, and expose it where source priority is resolved. | The resolved value carries source, timestamp, last sync, priority, and confidence. |
| FEA-9 | Public `/getting-started` page on `apps/web` that reuses the README install steps. | The page renders, links from the landing, and its commands match the README. |
| FEA-10 | Align the demo seed with plan 09: agent ACTIVE, `product.update` and `inventory.update` allowed with approval, and the documented capability matrix. | `npm run db:seed` produces the plan's demo state; the demo safety moment still refuses an unauthorized price change. |

## P1 - Admin console completeness

| ID | Requirement | Acceptance |
|---|---|---|
| ADM-1 | Tenant detail drill-down page using the existing GET: users, agents, channels, campaigns, data sources, media usage. Read-only. | Clicking a tenant opens the detail page with all six sections. |
| ADM-2 | Tenant list search, status filter, and health indicators. | Search by name or email, filter ACTIVE/SUSPENDED, and see a health marker per row. |
| ADM-3 | Audit filters (tenant, action, date) and expandable before/after values for `AdminActionLog` and tenant `AuditLog`. | Filters narrow the list; expanding a row shows before and after. |
| ADM-4 | Overview KPIs: users, 24h and 7d conversation and message volume, command queue, tick freshness, lease states. | All KPIs render from real queries, not placeholders. |
| ADM-5 | Fleet detail: lease age, lease holder token, last activity, and per-source freshness, including ERROR sources. | The Saluran and Operasional pages show holder and age; sources show freshness even when failing. |
| ADM-6 | Plans usage table shows percent of limit and an over-limit badge. | Usage above 100 percent is visibly flagged. |
| ADM-7 | Admin smoke checks: login, tenant list, suspended-tenant 403. Add them to `scripts/smoke-test.ts`. | The smoke suite fails if any admin check fails. |
| ADM-8 | Extract tenant provisioning into one shared core helper used by dashboard register and admin create, including the default `settings.sourcePriority`. | Both paths produce identical tenant defaults; a test compares them. |

## P1 - Billing and quota completeness

| ID | Requirement | Acceptance |
|---|---|---|
| BIL-1 | Complete the tenant Paket & Kuota page: included and excluded features, AI credit breakdown (agent replies and scenario modules), unique-sender MAU note, month start, invoice due date, and unpaid-first ordering. | Every field returned by the API is rendered; unpaid invoices sort first. |
| BIL-2 | Show the latest plan request regardless of status, so DONE and REJECTED are visible to the tenant. | A completed request remains visible with its terminal status. |
| BIL-3 | Link the admin billing page to the plan editor. | The link opens `/admin/plans`. |
| BIL-4 | Extend the smoke suite or add an assert-based self-check for entitlements, credits, invoices, and plan requests. | `npm run check:billing` (or the extended smoke suite) exits non-zero on a broken quota path. |

## P2 - Plan-level details and operations

| ID | Requirement | Acceptance |
|---|---|---|
| OPS-1 | Campaign UI: status cards (total, ACTIVE, sent this month), Meta tier and cost warnings in step 2, edit-mode thumbnails that use the API origin, and audience preview `byCategory`. | The cards render; the warnings appear for large audiences and Cloud API; thumbnails load in edit mode. |
| OPS-2 | Customer-facing stand-down and risk copy: send the configured fallback once when no agent is active, and add the Baileys ban-risk warning next to the ToS switch. | A paused agent produces one fallback message; the Baileys form names the ban risk. |
| OPS-3 | Small UX corrections: inline create tag/category in the contact editor, and hide contact edit from STAFF in both contacts and inbox. | STAFF sees no edit affordance; OWNER can create a tag without leaving the editor. |
| OPS-4 | Resolve the Sheets write-back claim. Default decision: remove it from PRD 02 because no tenant uses it. If the owner later wants it, it becomes its own PRD with a per-source opt-in flag. | PRD 02 no longer promises write-back; no dead `writeSheet` code remains, or it is documented as reserved. |
| OPS-5 | Restrict import to `.xlsx` and `.csv` with a clear error for `.xls`, or prove legacy `.xls` works and keep it. | The UI and parser agree; a `.xls` upload either succeeds or fails with a clear message. |
| OPS-6 | Complete the OpenAPI contract: add the Meta webhook GET/POST, health, and the openapi route, or document their exclusion in the contract. | `npm run check:openapi` covers the documented surface; the live spec matches. |
| OPS-7 | Resolve the outbox architecture claim. Conversation and test sends stay on the outbox; campaign sends stay in the campaign engine with the COR-1 claim. Amend PRD 08 to state this and remove the "all sends" wording. | PRD 08 matches the code; no duplicate send path is introduced. |
| OPS-8 | Operations docs: add the `pg_dump` backup command to the README, update the deploy steps for api and worker images, and add `API_JWT_SECRET` plus per-app env examples. | A fresh operator can follow the README to build, deploy, and back up the stack. |
| OPS-9 | Low-risk code truth-ups: add `packages/core` exports (or amend the plan), implement or remove `findSimilar` filters, and either implement read receipts or remove `markAsRead` from plan 07. | The plan and code agree; no reserved option is presented as working. |

## P2 - Documentation truth-up

| ID | Requirement |
|---|---|
| DOC-1 | Add a dated "superseded by PRD 08" note to the OpenClaw and single-process statements in PRD 01 and PRD 06. |
| DOC-2 | Update PRD 07 sections 23B.2 and 23B.5 to the api/worker topology and remove OpenClaw env references, or mark them historical. |
| DOC-3 | Update PRD 08: admin is built, Cloud API inbound and tag-triggered scenario runs execute in api/dashboard per the Phase 7 plan, and the outbox scope matches OPS-7. |
| DOC-4 | Fix the PRD 09 README row: no items remain DEFERRED; multi-channel is PENDING. |
| DOC-5 | Update plan statuses and paths: plans 02, 05, 08, 09, the monorepo plan, the admin plan Phase 5, the campaigns plan, and the shared UI plan. Tick implemented checkboxes and record verification. |
| DOC-6 | Update or retire `docs/report/2026-11-08-monorepo-status-report.md`; it still says admin is not built. |
| DOC-7 | Fix PRD 14 contradictions: void-and-reissue, bank-details env, feature-route count, and the plan-assignment audit claim. Fix PRD 12's CSS base wording. |

## Sequencing and verification

1. SEC-1 to SEC-5 and COR-1 to COR-7. Each item ships in its own commit
   with its acceptance evidence.
2. FEA-1 to FEA-10.
3. ADM-1 to ADM-8 and BIL-1 to BIL-4.
4. OPS-1 to OPS-9.
5. DOC-1 to DOC-7, which may ship alongside any batch.

Every batch requires:

- `npm run build` for the affected apps.
- `npm run check:encoding`.
- The relevant self-check or smoke check, extended where this PRD adds a
  path.
- Live verification on the clone stack for anything touching suspension,
  RLS, campaigns, billing, or the admin realm.

## Owner actions

- SEC-1 needs a non-owner Postgres role and its connection string on the
  clone. The agent writes the SQL and applies it on the clone; production
  waits for the cutover.
- OPS-4 defaults to removing the write-back claim. Say so now if you want
  the feature instead.
- FEA-2 refunds are record-only by design. Say so now if a payment
  integration is expected.

## Definition of done

This PRD is done when every P0, P1, and P2 item is either implemented and
verified or explicitly removed by a dated owner decision, the documents in
DOC-1 to DOC-7 match the code, and the encoding gate and builds pass.
