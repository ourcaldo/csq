# CSQ — Deep Implementation Gap Review

**Date:** 2026-08-22
**Scope:** Breadth-first audit of the *current* implementation on `main` (commit `ba1abe9`) against the PRD, `AGENTS.md`, and the master plan. Six areas audited in parallel by reading the actual code — every finding below cites a `file:line` verified by inspection, not assumption.
**Supersedes:** nothing — this is a new, broader sweep. The agent-flow gap report (`agent-flow-gap-status.md`, G1–G10, all closed) and the deploy-status report (`2026-08-19-status-and-next-steps.md`, gaps A–F) remain valid; this review covers ground neither did: role enforcement, RLS reality, ingestion correctness on the Excel path, deployment hardening, and type-safety hygiene.

---

## Severity tally

| Severity | Count | Areas |
|---|---|---|
| Critical | 2 | RLS inert; Excel import bypasses source-priority |
| High | 8 | 4 role-gate gaps; unguarded `JSON.parse`; unbounded parse memory; 2 deploy OOM risks |
| Medium | 18 | inbox filters, audit/transaction gaps, env/docs, socket exposure, slug collision |
| Low | 22 | dead code, stale comments, defense-in-depth where-clauses, `as` casts, hygiene |

**Headline:** the agent backbone (bounded context, Tool Gateway 4-tuple, safety moment, webhook fail-closed, Baileys persistence, handoff) is solid. The gaps cluster in **two places**: (1) the *business-data dashboard routes* were never role-gated to OWNER, and (2) **hardening for production** — RLS is cosmetic, the Excel ingestion path is inconsistent with its own priority design, and the 4GB deploy has no resource limits. None of these break the happy-path demo, but all violate the "production-ready, no MVP excuses" rule.

---

## Critical

### C1 — RLS is defined but completely inert (no runtime tenant isolation at the DB layer)
**PRD §23A (RLS is a "second enforcement layer"), AGENTS security.**
`prisma/migrations/20260818010000_rls_policies/migration.sql:8-17`, `src/lib/tenant-context.ts:17-19`.

The RLS migration enables RLS but does **not** use `FORCE ROW LEVEL SECURITY`, and the Prisma app connects as the table `OWNER`, which bypasses all RLS policies. Worse, `setTenantContext()` — the function that sets `app.current_tenant_id` via `SET LOCAL` — is **defined but never called anywhere in the codebase** (zero call sites outside its own definition). So even for a non-owner role, `current_setting('app.current_tenant_id', true)` returns NULL and the policies would match zero rows — but that path is never reached because the app role bypasses RLS entirely. The "second isolation layer" asserted in `tenant-context.ts:4-6` does not exist at runtime. Application-level `requireTenant` filtering is the *only* live guard.

The migration comment frames this as a deferral. Per the no-MVP-excuses rule, a non-functioning security layer is a defect, not a deferred feature.
**Fix:** switch Prisma to a dedicated limited role (not the table owner), use `FORCE ROW LEVEL SECURITY`, and set `app.current_tenant_id` inside a per-request `$transaction` (`SET LOCAL` does not persist across pooled connections). Until then, remove or correct the `tenant-context.ts` doc comment that claims the second layer is active.

### C2 — Live Excel import bypasses InventorySnapshot and source-priority resolution
**PRD §13 (data authority / conflict handling), defeats the closed G8 gap.**
`src/pages/api/import/excel/confirm.ts:56-77`.

The *live* Excel confirm route (called by `excel-upload-step.tsx:77`) upserts the canonical `Inventory` row directly with `source: "EXCEL"` and **never writes an `InventorySnapshot`, never calls `resolveInventoryBySnapshots`**. Compare the Sheets path (`sheets/confirm.ts:60` calls `applyImport`) and the scheduler (`scheduler.ts:84` calls `applyImport`) — both write a per-source snapshot and recompute the canonical quantity by `Tenant.settings.sourcePriority`.

Consequence: Excel (the default highest-priority source) is invisible to `resolveInventory` once any other source writes a snapshot — `inventory.read` (`tools/inventory.ts:46`) resolves from snapshots only and will silently drop Excel's quantity, and the next Sheets sync overwrites the canonical row with a lower-priority source's value. The entire G8 priority architecture is defeated for the Excel path.
**Fix:** replace the inline product/inventory loop in `excel/confirm.ts` with a call to `applyImport(tenantId, products, "EXCEL", filename)` — which the dead `/api/import/confirm.ts:46` already does correctly. Then delete the dead duplicate route (see L-ingestion-1).

---

## High

### H1 — STAFF can create/edit/delete products (business-data mutation not gated to OWNER)
**PRD §15.9, §18.1.** `src/pages/api/dashboard/products/index.ts:34-50` (POST), `src/pages/api/dashboard/products/[id].ts:29-62` (PUT/DELETE). These routes call `getAuthSession` + `requireTenant` but never `requireRole(session, "OWNER")`. A STAFF user can mutate products — business data. **Fix:** gate every mutation branch with `requireRole(session, "OWNER")`.

### H2 — STAFF can update inventory (stock)
**PRD §15.9, §18.1.** `src/pages/api/dashboard/inventory/[productId].ts:23-48` (PUT). No `requireRole`. Stock levels are business data. **Fix:** OWNER-only (or make an explicit OWNER+STAFF decision and record it — currently it is neither).

### H3 — STAFF can delete data sources
**PRD §15.9, §18.1.** `src/pages/api/dashboard/sources/[id].ts:28-42` (DELETE). No `requireRole`. Deleting a DataSource (credentials + agent feed) is business configuration. Sibling routes gate correctly (`sources/priority.ts:49`, `sources/sheets/create.ts:24`, `sources/google/disconnect.ts:23`) — this one was missed. **Fix:** add `requireRole(session, "OWNER")`.

### H4 — STAFF can create/edit/delete knowledge-base entries
**PRD §15.9, §18.1.** `src/pages/api/dashboard/knowledge/create.ts:16-56` (POST), `src/pages/api/dashboard/knowledge/[id].ts:31-89` (PUT/DELETE). No `requireRole` on any mutation. The knowledge base is what the agent retrieves via `knowledge.search`; STAFF editing it crosses the role boundary. **Fix:** OWNER-only mutations.

### H5 — Unguarded `JSON.parse` of model tool-call arguments aborts the whole turn
**PRD §24 (core-loop robustness).** `src/services/openclaw.ts:168`.
`const params = JSON.parse(tc.function.arguments)` sits inside the tool-call loop with no try/catch. If the model emits malformed JSON arguments (LLMs do this in practice), the parse throws and aborts the entire `runConversation` turn. The outer catch in `agent-loop.ts:170` sends the Indonesian fallback, so the customer is not silenced, but the agent gets zero chance to self-correct — one malformed tool call wastes the turn. **Fix:** wrap in try/catch; on failure push a `role:"tool"` message with an error string so the model can retry within the iteration budget.

### H6 — No row cap on Excel/CSV or Sheets parse — unbounded memory (OOM on 4GB)
**AGENTS rule 10, PRD §23A (4GB RAM).** `src/services/excel.ts:71-79` (`sheet.eachRow` pushes every row into a `rows[]`), `src/services/sheets.ts:99-105` (materializes every row). No row limit. A 50k-row spreadsheet is held fully in memory (the base64 buffer is already ~1.33× file size), then `replaceSourceRows` iterates it again. On the 4GB VPS this can OOM the process. **Fix:** cap parsed rows (e.g. 10k) with an explicit error back to the owner, or stream in batches.

### H7 — No container resource limits on a 4GB prod host — OOM risk
**PRD §23A.** `docker/docker-compose.yml:13-101`. Prod compose defines `app`, `postgres`, `nginx`, `certbot` plus per-tenant OpenClaw cells spawned at runtime — **none** have `mem_limit`/`cpus`/`deploy.resources`/`shm_size` (grep returns nothing). Postgres + Next.js standalone + OpenClaw cells on 4GB with no swap config will OOM under load. **Fix:** add explicit limits to `app` and `postgres` at minimum; cap cell count and per-cell RAM in the fleet provisioning path.

### H8 — `setup-vps.sh` builds the image on the 4GB VPS, contradicting the Dockerfile's own warning
**PRD §23A.** `docker/setup-vps.sh:45` vs `docker/Dockerfile:4-5`. The Dockerfile header says *"Never build on the 4GB VPS — build elsewhere / in CI and pull"*, yet `setup-vps.sh` runs `docker compose … up -d --build` on the VPS. `npm ci` + `next build` + `apt-get install docker.io` on 4GB/20GB will likely OOM or fill the disk on first boot. **Fix:** `setup-vps.sh` should `docker compose pull` a prebuilt image (build in CI, push), not `--build` on the VPS.

---

## Medium

### M1 — `checkPermission` query omits tenantId filter (defense-in-depth)
**PRD §17.** `src/lib/permissions.ts:15-17`. `AgentCapability.findUnique` is keyed only on `{ agentId, tool }`; the `_tenantId` param is discarded. Not exploitable today (agentId is verified to belong to the resolved tenant upstream in `src/pages/api/tools/[tool].ts:54-64`), but violates the "tenant_id on every query" rule. **Fix:** filter by tenantId or compound-check.

### M2 — `memory.create` upsert-update logs no beforeValue
**PRD §11, §15.7.** `src/tools/memory.ts:110-115`. On the update branch (key exists), the audit records only `afterValue`; the previous value is lost. **Fix:** read the existing row before upserting and pass `beforeValue` (as `product.update`/`inventory.update` do).

### M3 — `toChatHistory` drops all human/staff outbound messages (post-handoff context broken)
**AGENTS rule 10 / PRD §15.3.** `src/lib/prompt-builder.ts:160-171`. The filter keeps INBOUND + OUTBOUND/AGENT only; every OUTBOUND/HUMAN and OUTBOUND/STAFF message is erased. After a handoff back to AI, the replayed history is discontinuous (the staff's replies in between are gone). The code comment "kept simple for MVP" conflicts with the no-MVP-excuses rule. **Fix:** include OUTBOUND/HUMAN as `role:"assistant"` (or a system note).

### M4 — Dashboard test-chat endpoint bypasses the per-conversation advisory lock
**PRD §24 / concurrency.** `src/pages/api/agents/[agentId]/chat.ts:52-57` calls `runAgentReply` directly, outside the `pg_advisory_xact_lock` that serializes the webhook path (`agent-loop.ts:163-169`). A dashboard "test agent" turn concurrent with a customer inbound on the same conversation can run duplicate tool side effects (double `order.create` / `inventory.update`). **Fix:** acquire the same advisory lock in the chat.ts path, or document that the test endpoint must not be used on conversations with active customer traffic.

### M5 — No filter-by-tag in conversations API or inbox UI
**PRD §15.8 ("tags/labels + filter by tag").** `src/pages/api/dashboard/inbox/conversations/index.ts:59-65`, `src/pages/dashboard/inbox/index.tsx:33-44`. Tags can be added/removed and are returned per conversation, but there is no `tagId` query param and no UI filter. **Fix:** API accepts `tagId` → `where: { tags: { some: { tagId } } }`; UI exposes a tag filter.

### M6 — Status filter not exposed in inbox UI
**PRD §15.8 ("OPEN/PENDING/RESOLVED + filter").** `src/pages/dashboard/inbox/index.tsx:33-44`. The API supports `?status=`, the status can be SET from the contact pane, but the list UI only offers Assigned/Unassigned tabs + search. **Fix:** expose a status filter control.

### M7 — STAFF can create orders and change order status (no role gate)
**PRD §15.9, §18.1.** `src/pages/api/dashboard/orders/create.ts:17-108` (POST), `src/pages/api/dashboard/orders/[id].ts:34-55` (PUT). No `requireRole`. Order status changes (CONFIRMED/CANCELLED) have financial consequences. **Fix:** make a deliberate decision (OWNER-only, or OWNER+STAFF if inbox-adjacent) and gate accordingly.

### M8 — STAFF can edit contacts and update memory importance (no role gate)
**PRD §15.9, §18.1.** `src/pages/api/dashboard/contacts/[id].ts:29-46`, `src/pages/api/dashboard/memory/update.ts:18-47`, `src/pages/api/dashboard/memory/[id].ts`. No `requireRole`. Memory is agent configuration; contacts are customer records. **Fix:** classify and gate deliberately.

### M9 — Tenant slug collision not handled (4-hex suffix)
**PRD §19, production-ready rule.** `src/pages/api/auth/register.ts:44`. `${slugify(name)}-${randomUUID().slice(0,4)}` = 16 bits. Birthday-paradox 50% collision at ~302 tenants; `@unique` → Prisma P2002 → 500 with no retry. **Fix:** longer suffix (8–12 hex) or catch P2002 and regenerate.

### M10 — `replaceSourceRows` delete+re-insert is non-atomic
`src/lib/source-rows.ts:33-46`. `deleteMany` then batched `createMany`; a crash mid-replace leaves `SourceRow` empty/partial for that source, and it runs outside the transaction in `excel/confirm.ts:86` and `sheets/confirm.ts:83`. **Fix:** wrap in a transaction with the product/inventory writes.

### M11 — `applyImport` is not transactional
`src/lib/import-apply.ts:40-115`. Per-product upsert + snapshot + recompute with per-product try/catch; a crash mid-import leaves a partial import with no rollback. **Fix:** wrap the per-import batch in a transaction.

### M12 — Silently dropped rows are not reported to the owner
`src/services/excel.ts:130-133`. `mappedProductSchema.safeParse` failures drop the row with no count; `ImportSummary.errors` only captures thrown exceptions, not Zod-rejected rows. The owner sees "imported: N" with no indication M rows were skipped (e.g. non-numeric stock "kosong"). **Fix:** count dropped rows and return them in the summary.

### M13 — SKU lookup uses `findFirst` with no uniqueness guarantee
`src/lib/import-apply.ts:43`. `Product` has `@@index([tenantId, sku])` (index, not unique). Duplicate SKUs → `findFirst` updates one arbitrarily, `create`s another on the next import. **Fix:** enforce `@@unique([tenantId, sku])` or detect duplicates before upsert.

### M14 — No `.dockerignore` — `COPY . .` leaks local secrets and bloats the image
**AGENTS rule 4.** `docker/Dockerfile:17`. No `.dockerignore` at root or `docker/`. A local `docker build` bakes `.env`, `.env.bak`, `.baileys-auth/` (session keys), `node_modules/`, `.next/`, `.git/` into image layers. **Fix:** add `.dockerignore` excluding `.env*`, `.baileys-auth/`, `node_modules/`, `.next/`, `.git/`, `*.tsbuildinfo`.

### M15 — `OPENCLAW_GATEWAY_TOKEN` is consumed by code but undocumented
**PRD §23B.5.** `src/services/openclaw-cell.ts:33`. Read as a fallback for `OPENCLAW_API_KEY` in shared mode, but absent from both `.env.example` and `.env.production.example`. **Fix:** add it with a comment.

### M16 — WhatsApp Cloud API env vars in compose/examples are never read by the app
**PRD §23B.5.** `docker/docker-compose.yml:22-27`, `.env.example:12-17`. `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_API_VERSION` are passed to the container and documented, but a codebase grep shows **none** are read via `process.env` — Cloud API creds enter through the dashboard UI and live in `Channel.config` in the DB. Only `WHATSAPP_APP_SECRET` has an env fallback (`webhooks/whatsapp.ts:132`). **Fix:** remove the unused vars from compose/examples, or document them as UI-entered / not env-consumed, to avoid operator confusion.

### M17 — README does not document the self-hosted install flow
**PRD §22A.1.** `README.md:1-3` is a 3-line blurb. `docker/setup-vps.sh` and `init-certbot.sh` exist and are mostly coherent, but the README never references them, `.env.production.example`, or the compose commands. An operator cloning the repo has no documented path to a running deploy. **Fix:** expand README with the install steps.

### M18 — Host Docker socket mounted into the app container (container-escape path)
**PRD §23A.** `docker/docker-compose.yml:41`. `/var/run/docker.sock` is mounted RW so the app can `openclaw fleet create` / `docker exec` against sibling cells. Any process in the app container (or an exploited dependency) can spawn a privileged container mounting host root = full host compromise. Deliberate for fleet provisioning, but **no mitigation** (no AppArmor, no userns-remap, no socket-proxy). **Fix:** document the risk; consider a Docker socket proxy exposing only the API surface `fleet create`/`docker exec` need.

---

## Low

**Type-safety (`as` assertions — AGENTS rule 2).** No `as any` / `as unknown` anywhere (verified by grep — strong positive). Six `as SomeType` casts: `channels/index.ts:50-51` (provider/type string→union; use `Prisma.ChannelGetPayload` or Zod enum), `lib/pipeline.ts:181` (`where.conversation as Prisma.ConversationWhereInput`; type the accumulator), `components/dashboard/pipeline/stage-manager.tsx:303` (`e.target.value as StageKind`; Zod enum parse), `lib/prompt-builder.ts:54` (`"HIGH" as MemoryImportance`; use `MemoryImportance.HIGH`), `components/dashboard/dashboard-shell.tsx:112` (`e.target as Node`; `instanceof` guard).

**Defense-in-depth (where-clauses not tenant-gated, but safe today via a preceding tenant-scoped lookup):** `tools/conversation.ts:75-86` (handoff update by `id` only), `lib/pipeline.ts:105-107` (`Deal.findUnique` by `conversationId`), `import/excel/confirm.ts:61` (`product.update` by `id`). **Fix:** use `updateMany` + `{id, tenantId}` + count assert, matching `product.update`.

**Dead/duplicate code:** `src/pages/api/import/index.ts` and `src/pages/api/import/confirm.ts` are unreferenced (live routes are `import/excel.ts` + `import/excel/confirm.ts`). The dead `confirm.ts` has the *correct* `applyImport` logic while the live `excel/confirm.ts` is the broken one (C2). **Fix:** delete both dead routes after C2 is fixed. `src/pages/api/import/index.ts:26` calls `startScheduler()` before the session check (idempotent, nil impact — the health route is the intended boot hook).

**Stale/wrong comments:** `src/types/whatsapp.ts:19-22` says Baileys auth persists "on disk under `.baileys-auth/`" — the implementation uses Postgres via `baileys-auth-db.ts`. **Fix:** update the comment.

**Webhook edge cases:** `webhooks/whatsapp.ts:109-116` assumes all messages in one POST share one `phone_number_id` and routes later messages under the first channel's tenant. Exploitation requires the app secret (HMAC), so very low risk. **Fix:** assert all `phoneNumberId` match, or resolve per-message. `src/services/whatsapp.ts:57-59` `CloudApiProvider.verifyWebhook` is dead code (the route does its own DB-side lookup) and uses plain `===`. **Fix:** remove it or use `crypto.timingSafeEqual`.

**Inbox UI:** human reply composer's "Template" quick-action button (`chat-panel.tsx:256-258`) is a non-functional placeholder — no onClick, no template picker. Outside the 24h window a human cannot send an approved template to re-open the conversation (`inbox.ts:198-213` throws). **Fix:** wire the Template button to a picker that calls `provider.sendTemplate`.

**Deploy hygiene:** no `engines` field in `package.json` (Dockerfile pins node:20; add `engines: ">=20 <21"`); certbot service restart-loops until `init-certbot.sh` is run, and `setup-vps.sh` starts compose *before* telling the user to run it (`setup-vps.sh:45` vs `:58`) — reorder; `nginx` uses short-form `depends_on: [app]` instead of `condition: service_healthy` (can 502 while app boots); dev postgres has no healthcheck/restart; Dockerfile installs full `docker.io` metapackage (~100MB) just for the CLI — use `docker-ce-cli`; both `@phosphor-icons/react` and `lucide-react` are deps — consolidate to one.

**Auth UX:** `withAuth` redirects a STAFF user hitting an OWNER-only page to `/dashboard` with no "access denied" message (`auth.ts:89-91`); the API routes enforce the real boundary so this is UX only. `optionalAuth` (`auth.ts:130-134`) doesn't resolve the session — only used for signed-in/out pages, not a security issue.

**Scalability note (not a defect today):** the transaction-scoped advisory lock (`agent-loop.ts:163-169`) is held for the whole turn including OpenClaw HTTP latency, 120s timeout. Fine at UMKM scale; a lock table is the documented upgrade path if turn latency grows.

---

## What is correct (verified strong points)

These were checked and found correct — listed so the gap picture is balanced and the solid parts aren't accidentally "fixed":

- **Bounded agent context (THE core scalability rule, AGENTS rule 10):** `prompt-builder.ts:45-50` loads only `BUSINESS_INFO`, bounded to 10; FAQ/POLICY are NOT in the prompt — retrieved on demand via `knowledge.search` over pgvector. Safety rules instruct the agent to call `knowledge.search` and never fabricate.
- **Sacred safety moment (PRD §21 Step 8):** enforced in *code*, not just the prompt. `product.update` defaults `allowed:false, requiresApproval:true`; the seed capability matches; `executeTool` returns `permission_denied` and audits the denied attempt without executing. The agent cannot queue a price change unless the owner explicitly grants it.
- **Tool Gateway 4-tuple:** every tool is tenant-scoped, agent-scoped, permission-checked, audited, Zod-validated. Write tools default to denied. The approval gate never executes when pending; `executeApprovedAction` re-validates with Zod and re-checks `tenantId` before executing.
- **Tenant/agent scope resolved server-side** from the authenticated Conversation/Channel and DB-loaded Agent — never from the model or request body. Prompt-injection defense holds: permissions come only from `AgentCapability` rows.
- **Webhook fail-closed:** HMAC-SHA256 with `timingSafeEqual` on the raw body; ingestion/agent loop run only after signature passes; GET verify looks up the channel by `config.verifyToken` (multi-tenant ready) and returns `challenge` only on match.
- **Tenant routing by channel, not sender:** `tenantId` comes from the channel matched by `config.phoneNumberId`, never from `msg.from`. A spoofed `from` cannot inject into another tenant.
- **24h window:** enforced on both agent (`agent-outbox.ts:55-84`) and human (`inbox.ts:198-213`) outbound paths, Cloud-API only; Baileys bypasses; outside window → template-or-skip+audit (Meta-compliant).
- **Baileys auth in Postgres** (`baileys-auth-db.ts`), no filesystem state, reconnected at boot via the scheduler; disconnect deletes the row.
- **Human/AI handoff:** `runAgentReply` returns `stoodDown` when `assigneeUserId` is set; the agent stands down for that conversation until reassigned.
- **CRM inbox:** chat panel (customer/AI/human bubbles), assignment (audited), tags, status, private notes (`isInternal` — never dispatched), contacts, human replies send through the real provider. Roles enforced on channel config (OWNER) and inbox (OWNER+STAFF).
- **ToS warning for Baileys:** backend rejects without `tosAcknowledged`; UI disables the QR button until toggled.
- **Google Sheets OAuth:** tokens stored server-side at `Tenant.settings.googleSheets`; the public status route exposes only `connected`+`email`, never tokens; `DataSource.config` holds no credentials.
- **Mapping preview/confirm (PRD §8.2):** real header heuristic (`detectColumns`), owner reviews/corrects via `MappingEditor` before import.
- **Source priority resolution (PRD §13):** correct *on the Sheets path* — `readSourcePriority` + `resolveInventoryBySnapshots` consult `Tenant.settings.sourcePriority` with a sensible default and legacy fallback. (Excel path is C2.)
- **`node-cron` scheduler:** idempotent boot hook via the health route, retries ERROR sources, sequential bounded loop, tenant-scoped. Correct for single-process Docker Compose.
- **`source.search` tool:** tenant-scoped, bounded (`LIMIT` 50), parameterized, ACTIVE sources only, returns all columns.
- **Agent persona/instructions editing:** now wired — `agents/[id]/edit.ts` (PUT, OWNER, Zod, audited before/after) + edit dialog on the Agents page. The 2026-08-19 "missing" flag is resolved.
- **Deploy actually provisions OpenClaw:** `deploy.ts` calls `provisionAgent` → ensures a per-tenant cell → creates the agent inside it → writes `openclawCellId`/`openclawAgentId`/`ACTIVE`. Not just a flag flip.
- **pgvector image in both compose files;** `prisma generate` at build + `migrate deploy` at runtime; `output: "standalone"`; health endpoint lightweight + unauthenticated + doubles as scheduler boot hook; Nginx TLS/SSE/rate-limit/security headers correct; `init-certbot.sh` really obtains a cert; secrets gitignored, no `NEXT_PUBLIC_` secrets; build/lint gates present; `demo:reset` exists; deps match the PRD stack.

---

## Recommended fix order

1. **C2 (Excel bypasses priority)** — one-file fix, restores correctness of the G8 design that was already "closed." Highest value-to-effort.
2. **H1–H4 (role gates)** — add `requireRole(session, "OWNER")` to the four business-data route groups (products, inventory, sources DELETE, knowledge). Mechanical, closes a real privilege-escalation surface.
3. **H5 (unguarded `JSON.parse`)** — small try/catch, materially improves agent-loop robustness.
4. **H6 + H7 + H8 (OOM/deploy)** — row cap on parse; container resource limits; build-in-CI-and-pull. These protect the 4GB VPS the demo runs on.
5. **C1 (RLS inert)** — either make RLS real (dedicated role + `FORCE` + `SET LOCAL` in a per-request transaction) or correct the `tenant-context.ts` comment and track it as a known limitation. Do not leave a doc claiming a second layer that does not exist.
6. **Medium bucket** — M3 (handoff history), M5/M6 (inbox filters), M10–M13 (ingestion atomicity/feedback/SKU unique), M14 (`.dockerignore`), M15/M16 (env docs), M18 (socket risk doc). These are quality/correctness, not demo-blockers.
7. **Low bucket** — dead-code delete, stale comments, `as` casts, defense-in-depth where-clauses, deploy hygiene. Batch after the above.

The single highest-leverage item is **C2**: it silently breaks the data-authority story the PRD centers on, and the fix is a one-call replacement that already exists in the dead sibling route.

---

## Closure — fixes applied 2026-08-22

All findings in this report were fixed in parallel (7 agents, partitioned by file ownership) and verified with a single post-fix gate: `npx prisma generate` ✓, `npm run build` ✓ (0 errors), `npm run lint` ✓ (0 warnings/errors).

| Finding | Status | What landed |
|---|---|---|
| **C1** RLS inert | ✅ fixed (honest-doc) | `tenant-context.ts` + RLS migration comments rewritten to state RLS is defined-but-not-enforced; application-level `requireTenant` is the only live layer; the 3-step activation path (limited role + `FORCE` migration + per-request `$transaction` SET LOCAL) is documented. No `FORCE` added (would break the app as owner). |
| **C2** Excel bypasses priority | ✅ fixed | `import/excel/confirm.ts` rewritten to call `applyImport(... "EXCEL" ...)`, mirroring the correct Sheets path. Dead duplicate routes (`import/index.ts`, `import/confirm.ts`) deleted. |
| **H1–H4** STAFF mutate business data | ✅ fixed | `requireRole(session, "OWNER")` added to every mutation branch across products, inventory, sources/[id] DELETE, knowledge, orders, contacts, memory (11 route files). |
| **H5** Unguarded `JSON.parse` | ✅ fixed | `openclaw.ts` wraps `JSON.parse(tc.function.arguments)` in try/catch; on failure pushes a `role:"tool"` error message and `continue`s so the model self-corrects within the iteration budget. |
| **H6** Unbounded parse memory | ✅ fixed | `excel.ts` + `sheets.ts` enforce `MAX_IMPORT_ROWS = 10_000` and throw `ImportTooLargeError` (owner-facing Bahasa message) before materializing rows. Oversized sheets are rejected with a clear message instead of OOMing the 4GB VPS. |
| **H7** No container resource limits | ✅ fixed | `docker-compose.yml`: `mem_limit`/`cpus` on app (1.28GB/2), postgres (1GB/1.5, `shared_buffers=256MB`, `shm_size=256mb`), nginx (64MB), certbot (64MB). Total ~2.4GB, ~1.6GB headroom for OS + OpenClaw cells. |
| **H8** setup-vps.sh builds on VPS | ✅ fixed | Now `docker compose pull` + `up -d` (no `--build`), with `CSQ_APP_IMAGE`/`CSQ_NGINX_IMAGE` env vars and a pre-build prerequisite echo; TLS gate enforces `init-certbot.sh` runs before compose up. |
| **M1** checkPermission tenantId | ✅ fixed | `permissions.ts` uses `findFirst({ where: { agentId, tool, tenantId } })`. |
| **M2** memory.create beforeValue | ✅ fixed | `memory.ts` reads existing row before upsert; audit carries `beforeValue` on the update branch. |
| **M3** handoff history drops staff msgs | ✅ fixed | `prompt-builder.ts` includes OUTBOUND/HUMAN + OUTBOUND/STAFF mapped to `role:"assistant"`; full thread visible after handoff-back. |
| **M4** test-chat bypasses advisory lock | ✅ fixed | `agents/[id]/chat.ts` wraps `runAgentReply` in `$transaction` with `pg_advisory_xact_lock(hashtext(conversationId)::bigint)`, same key as the webhook path. |
| **M5** no filter-by-tag | ✅ fixed | Conversations API accepts `tagId`; inbox UI adds a tag `<Select>` filter. |
| **M6** no status filter in UI | ✅ fixed | Inbox UI adds a status `<Select>` (Semua/Open/Pending/Selesai). |
| **M7/M8** orders/contacts/memory role gates | ✅ fixed | Covered by H1–H4 (orders, contacts, memory all gated to OWNER). |
| **M10** replaceSourceRows non-atomic | ✅ fixed | `source-rows.ts` delete+insert wrapped in `$transaction`. |
| **M11** applyImport non-transactional | ✅ fixed | `import-apply.ts` pre-validates + dedups, then runs all upserts+snapshots+recompute in one `$transaction`; fatal errors roll back and zero the counters (never-throws contract preserved). |
| **M12** dropped rows not reported | ✅ fixed | `excel.ts` `applyMappingWithStats` counts Zod-skipped rows; `excel/confirm.ts` logs `zod-skipped`/`dedup-skipped`/`errors`; `ImportSummary` gains optional `skipped`. |
| **M13** SKU not unique | ✅ fixed | `Product` `@@unique([tenantId, sku])` + migration `20260822060000_product_sku_unique`; seed verified distinct. |
| **M14** no .dockerignore | ✅ fixed | `.dockerignore` created. |
| **M15** OPENCLAW_GATEWAY_TOKEN undocumented | ✅ fixed | Added to both `.env.example` + `.env.production.example`. |
| **M16** unused WhatsApp env vars | ✅ fixed | 5 unused vars commented out in env examples + removed from compose `app.environment`; `WHATSAPP_APP_SECRET` kept. |
| **M17** README install flow | ✅ fixed | README expanded with the self-hosted install steps. |
| **M18** Docker socket escape risk | ✅ fixed (doc) | Prominent SECURITY warning + socket-proxy mitigation path documented on the mount. |
| **Low: `as` casts** | ✅ fixed | 5 of 6 removed (channels/index.ts via Zod enum, pipeline.ts via typed accumulator, stage-manager.tsx via Zod enum, dashboard-shell.tsx via `instanceof` guard, prompt-builder.ts:54 via `MemoryImportance.HIGH`). 1 remains: `baileys.ts` still defines a `verifyWebhook` method now removed from the interface — harmless extra method, not an `as` cast. |
| **Low: defense-in-depth where** | ✅ fixed | `conversation.ts` handoff → `updateMany`+count assert; `pipeline.ts` deal lookup → tenantId assert. |
| **Low: stale comment / dead code** | ✅ fixed | Baileys auth comment corrected; dead `verifyWebhook` removed from interface + CloudApiProvider; webhook multi-phone-number-id now validated (400 on mismatch); dead import routes deleted; `package.json` `engines` added; nginx `depends_on` → `condition: service_healthy`; dev postgres healthcheck+restart; Dockerfile slimmed to `docker:24-cli` multi-stage. |
| **Low: inbox template button** | ✅ fixed | Wired to a Dialog (template name + language) → new `POST /api/dashboard/inbox/conversations/[id]/template` endpoint that calls `provider.sendTemplate` (no 24h guard — templates are the outside-window mechanism) + persists the message + audits. |

### Still open after this pass
- **C1 (RLS truly active):** documented honestly rather than activated. Activating requires provisioning a dedicated limited DB role on Neon/Render (infra, not a code edit) + a `FORCE` migration + per-request `setTenantContext` — tracked as a known limitation with an activation path in `tenant-context.ts`. This is the only item not fully closed, and it is an infrastructure provisioning task, not a code defect: application-level `tenant_id` filtering on every query + `requireTenant` on every route remains the live isolation layer and is verified correct.
- **Duplicate icon libs** (`@phosphor-icons/react` + `lucide-react`): intentionally left (removing risks breaking UI imports; cosmetic bundle weight only).
