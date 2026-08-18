# Phases 0–10 Implementation Verification Report

**Project:** CSQ (HackFest MVP)
**Date:** 2026-08-17
**Audited commit:** `e3ee67f` (Merge phases 0-10 implementation) on `main`
**Method:** Five parallel verification agents, each reading its phase plan file(s) in full and opening the actual implementation files to confirm every checklist item. Build/lint gates run where the sandbox allowed; type-correctness verified by inspection where the sandbox OOM'd on `tsc`/`next build`.
**Repo:** https://github.com/ourcaldo/csq

---

## TL;DR

**5 of 11 phases fully complete. The critical backbone (Tool Gateway, agent loop, Cloud API, deployment stack, data layer) is solid and the sacred demo safety moment is preserved. But 6 phases are incomplete, and there is one serious security flaw that must be fixed before any demo or merge.**

| Phase | Focus | Verdict |
|-------|-------|---------|
| 0 | Scaffolding & Foundation | ✅ COMPLETE |
| 1 | Data Layer (Prisma, Schema, Vector, CRM models) | ❌ INCOMPLETE |
| 2 | Auth & Tenant Isolation | ❌ INCOMPLETE |
| 3 | Business Data CRUD + Knowledge + Memory + Contacts/Tags | ✅ COMPLETE |
| 4 | Data Ingestion (Excel/CSV, Google Sheets) | ✅ COMPLETE |
| 5 | Tool Gateway (Registry, Permissions, Audit) | ✅ COMPLETE |
| 6 | OpenClaw Integration (Agent Runtime, Cells) | ❌ INCOMPLETE |
| 7 | WhatsApp Channel + Inbox Backend | ❌ INCOMPLETE |
| 8 | Dashboard UI + CRM Inbox UI | ❌ INCOMPLETE |
| 9 | Demo Prep & Marketing Pages | ❌ INCOMPLETE |
| 10 | Deployment (Docker, Nginx, TLS) | ✅ COMPLETE |

**Build gate:** `npm run build` green; `npm run lint` zero warnings/errors (verified on the host before push). Sub-agent sandboxes OOM'd on `tsc`/`next build`; type-correctness there was confirmed by inspection.

---

## Non-Negotiable Constraint Audit

These are the constraints from `CLAUDE.md` that cost the most if missed.

| Constraint | Status | Evidence |
|---|---|---|
| `tenant_id` on **every** Prisma model | ✅ FIXED (was ❌ BREACH) | `OrderItem`, `AgentCapability`, `ConversationTag` now carry `tenantId` + FK + index; migration backfills from parents. |
| No `as any` / `as unknown` in `src/` | ✅ CLEAN | Grep across `src/` returned zero matches. `db.ts` explicitly avoids `as` casting. |
| All pgvector raw SQL confined to `lib/vector.ts` | ✅ CLEAN | Grep for `vector(`, `<=>`, `CREATE EXTENSION vector` hits only `src/lib/vector.ts` (plus DDL in the init migration, as expected). |
| Vector columns declared `Unsupported("vector")` | ✅ CLEAN | `schema.prisma:293`; migration creates actual `vector(1536)` column. |
| Pages Router (no `src/app/`) | ✅ CLEAN | No `src/app/` dir; `components.json` has `rsc:false`; `next.config.mjs` uses `output:"standalone"`. |
| Dashboard auth via `withAuth(getServerSideProps)`, **no middleware** | ✅ CLEAN | All 9 dashboard pages use `withAuth`; no `middleware.*` file exists. |
| Secrets never in client code | ✅ CLEAN | No `process.env.*` / integration env names in `src/components/**` or non-api `src/pages/**`. `OPENCLAW_API_KEY` only in server API route `api/tools/[tool].ts`. |
| Agents read-only by default; writes per-tool permission; selected writes require owner approval | ✅ CLEAN | `executeTool` calls `checkPermission` (`execute.ts:48`); denied writes audited and returned without execution. `product.update` etc. default `{allowed:false, requiresApproval:true}`. |
| Demo safety moment preserved (refuse unauthorized price change) | ✅ CLEAN | Blocked + audited at `execute.ts:49-62`; reinforced in system prompt (`prompt-builder.ts:66-76`). |
| Tool Gateway is the **only** path between agents and business data | ✅ CLEAN (with nuance) | OpenClaw tool_calls routed through `executeTool` (`services/openclaw.ts:145`). `agent-loop.ts` and `openclaw.ts` import Prisma, but only for conversation/agent **bookkeeping** — not business-data access. Core isolation invariant holds. |
| Webhook signature verification | ✅ FIXED (was ❌ BYPASSABLE) | `webhooks/whatsapp.ts` now fail-closed: resolves `appSecret` from channel config then `process.env.WHATSAPP_APP_SECRET`, returns 401 if unset or on HMAC mismatch. |

---

## Critical Issues (fix before demo/merge)

### ~~C1. Webhook signature verification is bypassable — SECURITY~~ ✅ FIXED (2026-08-17)
**File:** `src/pages/api/webhooks/whatsapp.ts:130-133`
**Problem:** When `channel.config.appSecret` is absent, the handler logs a warning and proceeds **without verifying `X-Hub-Signature-256`**. `appSecret` is `optional` in the Zod schema (`src/types/whatsapp.ts:14`), and `WHATSAPP_APP_SECRET` is **never referenced anywhere in `src/`**. A misconfigured or default channel silently accepts unsigned POSTs — an attacker can spoof inbound WhatsApp messages, which then flow into the agent loop.
**Fix applied:** Now fail-closed — resolves secret from channel config first, then `process.env.WHATSAPP_APP_SECRET`; returns 401 if neither is set, and 401 on HMAC mismatch. Unsigned POSTs are no longer accepted.

### ~~C2. `tenant_id` missing on 3 Prisma models — NON-NEGOTIABLE BREACH~~ ✅ FIXED (2026-08-17)
**Files:** `prisma/schema.prisma:259` (`OrderItem`), `:334` (`AgentCapability`), `:466` (`ConversationTag`)
**Problem:** Violates the "tenant_id on every table from day one" constraint. These are junction/child tables (tenant derivable via parent), but the constraint is unconditional.
**Fix applied:** Added `tenantId` + `@relation` + `@@index([tenantId])` to all three; new migration `20260818000000_tenant_id_junction_tables` backfills from parent rows; all create sites (`tools/order.ts`, `api/dashboard/orders/create.ts`, `lib/permissions.ts`, inbox `tags.ts`) updated to pass `tenantId`.

### ~~C3. RLS migration entirely missing~~ ✅ FIXED (2026-08-17)
**Plan:** Phase 1 task 1.8 requires a second migration adding RLS policies on key tables.
**Problem:** Only one migration exists (`20260817113947_init`). `src/lib/tenant-context.ts` sets `app.current_tenant_id` via `SET LOCAL`, but **no policy consumes it** — the second isolation layer the plan requires is absent. App-level `tenantId` filtering (`requireTenant`) remains the sole guard, which the plan allows as "primary" for MVP but not as the only layer.
**Fix applied:** New migration `20260818010000_rls_policies` enables RLS + a `tenant_isolation` policy (`USING/WITH CHECK tenant_id = current_setting('app.current_tenant_id', true)`) on all 19 tenant-owned tables. Not FORCED (Prisma pooled connections don't persist `SET LOCAL`), so the owner-bypassing app role keeps working while policies enforce for any non-owner role — switching the app to a limited role post-MVP activates this layer with no code changes.

---

## High-Priority Gaps (flagship features missing)

### H1. CRM Inbox UI — Phase 8.9 (headline dashboard feature)
**Status:** Backend APIs exist at `src/pages/api/dashboard/inbox/*`; **no UI exists.** No `src/pages/dashboard/inbox/`, no `conversation-list`/`chat-panel`/`message-bubble`/`tag-picker`/`assignee-picker` components. The shared inbox — a PRD core feature — is not operable from the dashboard.

### H2. Agent Management UI — Phase 8.2
**Status:** No `src/pages/dashboard/agents/`. No capability-toggle UI, no deploy/pause UI anywhere. Owners cannot configure or control agents through the dashboard.

### H3. Approvals / Activity / Settings / Team UI — Phase 8.6–8.8, 8.11
**Status:** Backends exist (`api/dashboard/approvals/*`), but no `/dashboard/approvals`, `/dashboard/activity`, `/dashboard/settings`, or `/dashboard/team` pages. ~9 of ~18 planned dashboard pages present; all detail/edit sub-pages (`products/[id]`, `orders/[id]`, `contacts/[id]`, `knowledge/[id]`, `knowledge/new`) missing.

### ~~H4. Channels / Onboarding API~~ ✅ FIXED (2026-08-17) — Phase 7.5
**Status:** New `src/pages/api/dashboard/channels/{connect,disconnect,test}.ts` (OWNER-only, tenant-scoped). `connect` accepts `provider` (CLOUD_API | BAILEYS), Zod-parses provider-specific config, and **enforces `tosAcknowledged` before enabling Baileys** (returns PERMISSION_DENIED otherwise). `disconnect` tears down the Baileys socket. `test` sends a small text via the channel's provider.

### ~~H5. Baileys provider is a non-functional stub~~ ✅ FIXED (2026-08-17) — Phase 7.3
**File:** `src/services/baileys.ts`
**Status:** Wired with `@whiskeysockets/baileys` + `pino`. `connectBaileysChannel` starts the socket, persists auth state on disk (`.baileys-auth/<channelId>`), emits the QR for the UI, reconnects on transient close, and feeds `messages.upsert` → `ingestInboundMessage` + `processInboundWithAgent`. `BaileysProvider.sendText` sends via the live socket. `startBaileysChannels` reconnects already-CONNECTED channels at boot (called from the scheduler). `.baileys-auth/` gitignored.

### ~~H6. Demo agent not seeded~~ ✅ FIXED (2026-08-17) — Phase 9A.2
**File:** `prisma/seed.ts`
**Status:** Seed now creates a `Kopi Nusantara CS` agent (ACTIVE, Bahasa instructions reinforcing the no-unauthorized-price-change rule), explicit `AgentCapability` rows for all 11 tools (reads allowed, writes denied+approval — deterministic), and a WhatsApp CLOUD_API channel (DISCONNECTED; owner fills real creds to demo). `seed.ts` refactored to export `seedDemo()` for reuse.

---

## Medium-Priority Gaps (completeness)

| # | Gap | Phase | File / location |
|---|-----|-------|-----------------|
| ~~M1~~ | ~~Deploy/pause agent routes missing~~ ✅ FIXED | 6.6 | `api/dashboard/agents/[id]/deploy.ts` + `pause.ts` (OWNER-only, tenant-scoped) |
| ~~M2~~ | ~~Documented `chat.ts` route missing~~ ✅ FIXED | 6.4 | `api/agents/[agentId]/chat.ts` (session-auth, runs one agent turn via `runAgentReply`) |
| ~~M3~~ | ~~Full agent provisioning flow partial~~ ✅ FIXED | 6.2 | `provisionAgent` now writes `openclawCellId` + `openclawAgentId` + ACTIVE; instructions supplied at runtime via system prompt (sidecar adaptation documented) |
| ~~M4~~ | ~~Staff-invite route missing~~ ✅ FIXED | 2.10 | `src/pages/api/dashboard/team/invite.ts` (OWNER-only, Zod, generates temp password) |
| ~~M5~~ | ~~`requireRole` helper missing~~ ✅ FIXED | 2.10 | `requireRole(session, ...roles)` in `src/lib/auth.ts`; all 9 inline role checks refactored to use it |
| ~~M6~~ | ~~`requireAuth`/`optionalAuth` exports missing~~ ✅ FIXED | 2.5 | both exported from `src/lib/auth.ts` |
| ~~M7~~ | ~~Sign-in `authorize()` not Zod-validated~~ ✅ FIXED | 2.1 | `signInSchema` safeParse in `authorize()` |
| ~~M8~~ | ~~Private-notes route `[id]/notes.ts` missing~~ ✅ FIXED | 7.7 | `inbox/conversations/[id]/notes.ts` (internal message, not sent to customer, audited) |
| ~~M9~~ | ~~SSE stream route `inbox/stream.ts` missing~~ ✅ FIXED | 7.7 | `inbox/stream.ts` (GET, SSE poll of new messages + heartbeat) |
| ~~M10~~ | ~~`writeSheet` not implemented~~ ✅ FIXED | 4.3 | `writeSheet` in `src/services/sheets.ts` (opt-in; spreadsheets write scope added) |
| ~~M11~~ | ~~`Inventory` missing `@@unique([tenantId, productId])`~~ ✅ FIXED | 1.2 | composite unique added (kept `productId @unique` for 1:1 relation) |
| ~~M12~~ | ~~`.env.example` missing `DATABASE_URL_UNPOOLED`~~ ✅ FIXED | 1.1 | added to `.env.example` + `.env.production.example` |
| M13 | nginx uses `${CERT_DOMAIN}` in cert paths with no `envsubst` entrypoint — TLS will fail to load in prod | 10.3 | `docker/nginx/nginx.conf:26-27`, `docker/nginx/Dockerfile` |
| M14 | `app` service has no `healthcheck:` block despite `/api/health` existing | 10.8 | `docker/docker-compose.yml` |
| ~~M15~~ | ~~`prisma/reset-demo.ts` + `demo:reset` script missing~~ ✅ FIXED | 9A.5 | `prisma/reset-demo.ts` + `npm run demo:reset` (deletes tenant via cascade, re-seeds) |
| ~~M16~~ | ~~Demo `docs/demo/products.xlsx` missing~~ ✅ FIXED | 9A.1 | `docs/demo/products.xlsx` (3 products, Indonesian headers) |
| ~~M17~~ | ~~Parsed Excel/Sheet rows not Zod-validated~~ ✅ FIXED | 4.1 | `mappedProductSchema` validates each parsed row in `applyMapping`; invalid rows dropped |
| ~~M18~~ | ~~Confidence score is aggregate, not per-field~~ ✅ FIXED | 4.1 | `detectColumns` returns `fieldConfidence` per field (graded by keyword rank) + aggregate |
| M19 | 3 shadcn base components not added: `switch`, `separator`, `dropdown-menu` | 0.3 | `src/components/ui/` |
| ~~M20~~ | ~~`vector(1536)` column undocumented by a SQL comment~~ ✅ FIXED | 1.4 | SQL comment added in `migration.sql` |
| ~~M21~~ | ~~Dashboard mutations not audited~~ ✅ FIXED | 3 (tension) | `logHuman` helper in `lib/audit.ts`; all dashboard mutation routes (products/inventory/orders/contacts/knowledge/memory/tags/sources + notes) now audit |

---

## What Is Genuinely Solid

- **Phase 5 — Tool Gateway (the critical-path bottleneck):** Every tool call is tenant-scoped, agent-scoped, permission-checked, audited, and Zod-validated. All 5 domain tools (product, inventory, order, customer, knowledge) registered with correct defaults (reads allowed; writes denied + approval). `executeApprovedAction` replays owner-approved actions with re-validation. Approvals backend (list/approve/reject, OWNER-only) complete. This is the project's hardest piece and it is done right.
- **Phase 4 — Ingestion:** Excel/CSV upload→preview→confirm and Sheets OAuth→connect→confirm→sync both work, tenant-scoped, with a shared `import-apply.ts` applier and `node-cron` 15-min scheduler (server-only guard). Error → `status:"ERROR"`, retry next tick. Source priority in `Tenant.settings`.
- **Phase 3 — Business CRUD:** Products/inventory/orders/contacts/tags/knowledge/memory/sources APIs all present, tenant-scoped via session, Zod-validated, role-enforced where required. Transactional order creation with atomic stock decrement.
- **Phase 10 — Deployment:** Multi-stage Dockerfile with `output:"standalone"` + `prisma migrate deploy` at startup; prod compose with `pgvector/pgvector:pg16`, Nginx (security headers, gzip, rate-limit on webhook, SSE/WS upgrade headers), Certbot TLS, idempotent `setup-vps.sh`, `.env.production.example`. 4GB-RAM-aware (OpenClaw sidecar opt-in via `--profile`, `mem_limit: 768m`).
- **Phase 0 — Scaffolding:** Pages Router, TS/ESLint/Tailwind, `@/*` alias, Prisma + seed, Docker dev (pgvector), env templates, gitignore hardened this round to exclude `.env.bak`, `.neon`, `*.tsbuildinfo`.
- **Safety moment:** Intact at the Tool Gateway and prompt layers — unauthorized price change is blocked, audited, and never executed.

---

## Per-Phase Detail

### Phase 0 — Scaffolding & Foundation — ✅ COMPLETE
All structural/config items verified present: `package.json` (next 14.2, react 18.3.1), `tsconfig.json` (`@/*` alias), `tailwind.config.ts`, `.eslintrc.json`, `components.json` (`rsc:false`), full `src/` directory layout, `docker-compose.dev.yml` (`pgvector/pgvector:pg16`), `.env.example`/`.env.production.example`, `.gitignore`. Deviations: `tsx` used instead of `ts-node` (functionally equivalent); 3 shadcn base components not added (M19); initial commit message is `Initial commit` rather than the plan's prescribed `chore: scaffold...`.

### Phase 1 — Data Layer — ❌ INCOMPLETE
DONE: all 17 models with correct fields (Tenant, User, Agent, Channel, Product, Inventory, Order, OrderItem, Knowledge, KnowledgeEmbedding, Memory, DataSource, AgentCapability, AuditLog, Approval, Conversation, Contact, Message, Tag, ConversationTag); `CREATE EXTENSION vector` in init migration; `Unsupported("vector")` + `vector(1536)` column; `db.ts` singleton; `vector.ts` with `upsertEmbedding`/`findSimilar`/`deleteEmbedding`; `seed.ts` (Toko Kopi Nusantara); `types/api.ts` envelope. INCOMPLETE: ~~RLS migration missing (C3)~~ ✅ FIXED; ~~`tenant_id` missing on 3 models (C2)~~ ✅ FIXED; ~~Inventory composite unique missing (M11)~~ ✅ FIXED; ~~`.env.example` missing `DATABASE_URL_UNPOOLED` (M12)~~ ✅ FIXED.

### Phase 2 — Auth & Tenant Isolation — ❌ INCOMPLETE
DONE: NextAuth config with JWT/session callbacks embedding userId/tenantId/role (`auth.ts:14-63`); bcrypt password hashing (`password.ts`); register page+API with Zod + slug + nested OWNER create; login page; `withAuth` HOC via `getServerSideProps`; `getAuthSession` API helper; `tenant-context.ts`; `_app.tsx` SessionProvider; no middleware. INCOMPLETE: ~~`requireRole` helper (M5)~~ ✅ FIXED, ~~`requireAuth`/`optionalAuth` exports (M6)~~ ✅ FIXED, ~~staff-invite route (M4)~~ ✅ FIXED; ~~sign-in not Zod-validated (M7)~~ ✅ FIXED.

### Phase 3 — Business Data CRUD — ✅ COMPLETE
Every CRUD route enumerated in the plan exists, is tenant-scoped via session, Zod-validated, and role-enforced (tags create/rename/delete OWNER-only). Transactional order creation. Approvals/audit/permissions machinery backing the agent safety path in place. Tension resolved: ~~dashboard human-write mutations are not audited (M21)~~ ✅ FIXED — `logHuman` now audits all dashboard mutation routes.

### Phase 4 — Data Ingestion — ✅ COMPLETE
Excel/CSV (exceljs) upload→preview→confirm; Sheets (googleapis) OAuth→connect→confirm→sync; shared `import-apply.ts` applier; `node-cron` 15-min scheduler with server-only guard; error→ERROR status; source priority in `Tenant.settings` (OWNER-only PUT). Minor non-blocking gaps: ~~`writeSheet` (M10)~~ ✅ FIXED, ~~aggregate confidence (M18)~~ ✅ FIXED, ~~parsed rows not Zod-validated (M17)~~ ✅ FIXED.

### Phase 5 — Tool Gateway — ✅ COMPLETE
Registry (`tools/index.ts`, `Map`-based, no-dup guard); `permissions.ts` (override → default, grant/revoke); `audit.ts` (append-only, `Prisma.DbNull` defaults); `execute.ts` full flow (lookup → Zod → permission → denied/approval/allowed, all 5 error codes); `executeApprovedAction` (re-validate + tenant-check + stamp APPROVED + mark Approval only on success); `api/tools/[tool].ts` (resolves tenant from session OR `x-openclaw-api-key`, never from body); `api/tools/index.ts` (list); all 5 domain tools with correct defaults and `describeChange`. Safety moment preserved.

### Phase 6 — OpenClaw Integration — ❌ INCOMPLETE
DONE: `services/openclaw.ts` (sidecar/OpenAI-compatible on loopback:18789, client-side function tools per validated memory note — defensible adaptation of the plan's cell-CRUD surface); `agent-loop.ts` (Understand→Retrieve→Reason→Check Permission→Act→Verify→Record); `prompt-builder.ts` (persona + owner instructions + business info + FAQs + policies + safety rules + Bahasa Indonesia); tool-gateway routing; conversation/message persistence. INCOMPLETE: ~~deploy/pause routes (M1)~~ ✅ FIXED; ~~documented `chat.ts` route (M2)~~ ✅ FIXED; ~~full provisioning flow — `openclawCellId` field never written (M3)~~ ✅ FIXED.

### Phase 7 — WhatsApp Channel + Inbox Backend — ❌ INCOMPLETE
DONE: `WhatsAppProvider` interface + factory (`whatsapp-provider.ts`); Cloud API provider (`whatsapp.ts`, Graph v25.0, Zod parse, 24h window in `inbox.ts:198-213`); shared ingest path (`inbox.ts`: findOrCreateConversation → recordInboundMessage); webhook always-ACK + raw-body HMAC + fire-and-forget agent; inbox APIs (conversations list/detail, messages, tags add/remove, contacts, tags). INCOMPLETE: ~~**webhook signature bypassable (C1)**~~ ✅ FIXED; ~~Baileys stub non-functional (H5)~~ ✅ FIXED; ~~channels/onboarding API entirely missing, no `tosAcknowledged` enforcement (H4)~~ ✅ FIXED; private-notes + SSE routes missing (M8, M9); ~~`requireRole` helper missing (M5)~~ ✅ FIXED.

### Phase 8 — Dashboard UI + CRM Inbox UI — ❌ INCOMPLETE
DONE: 9 CRUD pages (products, inventory, orders, contacts, tags, knowledge, memory, sources, index) all auth-guarded via `withAuth` and using the shared shell; shadcn primitives; `use-api.ts`; `api-client.ts`; `_app.tsx` SessionProvider; `dashboard-shell.tsx`, `confirm-dialog.tsx`, `pagination.tsx`, `state-notice.tsx`. INCOMPLETE: CRM inbox UI entirely missing (H1); agent management UI missing (H2); approvals/activity/settings/team UI missing (H3); all detail/edit sub-pages missing; inbox shared components missing. Route structure flattened (`/dashboard/products` vs plan's `/dashboard/data/products`) — functionally equivalent.

### Phase 9 — Demo Prep & Marketing — ❌ INCOMPLETE
Part B (marketing) — **acceptably deferred** per plan/master-plan; landing page is an explicit placeholder redirecting to `/dashboard`; login/register built. Part A (demo prep, HIGH PRIORITY) — ~~demo agent not seeded (H6)~~ ✅ FIXED; ~~no `docs/demo/products.xlsx` (M16)~~ ✅ FIXED; ~~no `prisma/reset-demo.ts`/`demo:reset` (M15)~~ ✅ FIXED. Safety moment preserved at runtime layer.

### Phase 10 — Deployment — ✅ COMPLETE
DONE: multi-stage Dockerfile + standalone + Prisma client copy + `migrate deploy`; prod compose (app + pgvector postgres + nginx + certbot, OpenClaw opt-in sidecar `mem_limit:768m`); nginx reverse proxy (HTTP→HTTPS, ACME, security headers, gzip, webhook rate-limit, SSE/WS upgrade); Certbot TLS + renewal loop; `setup-vps.sh` (idempotent); `.env.production.example`; `/api/health` (DB probe, 503 on down); migrate-deploy-not-dev strategy. Minor: app healthcheck not wired into compose (M14); nginx `${CERT_DOMAIN}` needs envsubst (M13); backup command undocumented.

---

## Recommended Fix Order

1. **C1** — webhook fail-closed + require `appSecret` (security, small)
2. **C2** — add `tenant_id` to 3 models + migration (constraint, small)
3. **C3** — RLS migration (constraint, medium)
4. **M11, M12, M13, M14** — small schema/deploy fixes in the same pass
5. **H6** — seed demo agent + capabilities + channel (unblocks end-to-end demo)
6. **H1** — CRM inbox UI (flagship dashboard feature)
7. **H2, H3** — agent management + approvals/activity/settings/team UI
8. **H4, H5** — channels/onboarding API + Baileys wiring
9. **M1–M10, M15–M21** — remaining completeness gaps

---

## Notes & Caveats

- Build/lint gates (`npm run build`, `npm run lint`) were verified **green on the host** before the push that triggered this audit. Sub-agent sandboxes OOM'd on `tsc`/`next build` (~770MB heap); type-correctness there was confirmed by inspection. The OOM is an environment constraint, not a code defect.
- Two "literal-instruction" nuances in Phase 5: `agent-loop.ts` and `openclaw.ts` import Prisma, but only for conversation/agent **bookkeeping** — the agent's business-data access still flows exclusively through `executeTool`. The Tool-Gateway isolation invariant for business data is fully preserved.
- Phase 9 Part B (marketing) deferral is **explicitly allowed** by the plan and master plan; it is not counted against completeness.
- The `tenant_id` breach (C2) is real but the affected tables are junction/child tables whose tenant is derivable via a parent FK. The risk is a gap in defense-in-depth, not an active cross-tenant leak — but the constraint is unconditional and should be honored.
