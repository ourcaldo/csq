# Fix Plan - 10 Defects from the 2026-10-31 Deep Dive

**Date:** 2026-10-31
**Status:** In execution - see the execution status table below
**Source of findings:** `docs/2026-10-31-project-deep-dive.md` (D1-D10)
**Scope:** fix all 10 defects, in 5 phases, without new runtime dependencies.

---

## 0. Execution status

Decisions confirmed by the owner on 2026-11-01: A = hard scope to the conversation's customer,
B = delete the chat route, C = RLS coverage only, D = debounced media reply. Database changes are
applied directly to Neon (project `winter-flower-03790042`) over the MCP connection; migration SQL
plus a matching `_prisma_migrations` bookkeeping row are applied together so `prisma migrate
deploy` at container boot stays a no-op. A backup branch of the production database was taken
before any change: `pre-fix-backup-2026-11-01` (`br-muddy-feather-b3vsoacz`).

| Defect | Status | Notes |
|---|---|---|
| D1 turn lease + LLM budget | **FIXED** | Lease columns applied to Neon; lease SQL verified live (acquire / busy / wrong-owner-release / recover). |
| D2 customer scope | Pending | |
| D3 inbound idempotency | **FIXED** | 11 duplicate rows deduplicated on Neon (kept earliest of each group); partial unique index applied + bookkeeping row; ACK moved ahead of ingest. |
| D4 newest-20 history | Pending | |
| D5 delete chat route | Pending | Approved for deletion. |
| D6 media classification | Pending | |
| D7 stream cursor | Pending | |
| D8 HNSW index | Pending | |
| D9 RLS coverage | Pending | |
| D10a order paging | Pending | |
| D10b pipeline unique | Pending | |
| D10c credentials table | Pending | |
| D10d cron lock | Pending | |
| D10e event bus | Pending | |
| D10f encoding guard | Pending | |
| D10g deploy docs | Pending | |

---

## 1. Principles for every fix

- **Root cause, not symptom.** No retries-around-a-broken-lock, no "increase the timeout".
- **No new infrastructure.** No Redis, no queue, no test framework. Postgres is the only coordination point.
- **No `as` casts.** Zod at every external boundary; `z.infer` is the source of truth.
- **Tenant scope on every query.** New queries carry `tenantId` even when the parent lookup already proved it.
- **Least code.** Each fix is the smallest change that is correct at production scale, not the smallest that demos.
- **Each phase ships independently**: build + lint + verification, then commit and push.
- **Additive migrations only**, except the two data steps explicitly marked destructive (they are run manually,
  with approval, outside `migrate deploy`).

---

## 2. Phase overview

| Phase | Defects | Theme | Size | Depends on |
|---|---|---|---|---|
| 1 | D1, D3, D4 | Agent turn: availability, idempotency, context correctness | L | - |
| 2 | D2, D5, D10a | Customer data scope + dead endpoint + order paging | S | - |
| 3 | D6, D7 | Inbound media classification + inbox stream | M | Phase 1 (shares webhook path) |
| 4 | D8, D9, D10b | DB hardening: vector index, RLS coverage, pipeline uniqueness | S | - |
| 5 | D10c-f | Hygiene: credentials table, cron lock, event bus, encoding guard | M | Phase 4 (migrations) |

Phases 1 and 2 are independent and can be done in either order. Phase 3 must follow Phase 1 because both rewrite
the webhook ingest path. Phase 4 is pure DDL. Phase 5 is independent except for its migrations.

**Version:** 2.0.0 (schema changes + one removed API route).

---

## 3. Decisions to confirm before starting

| # | Decision | Recommended | Why |
|---|---|---|---|
| A | **D2 scope:** should the agent be able to look up an order belonging to a *different* phone number (e.g. "saya pesan pakai nomor lain")? | **No - hard scope to the conversation phone.** A human can handle cross-number cases. | PRD 18.1 requires server-side customer scope. Allowing cross-customer reads is the actual defect. |
| B | **D5:** delete `/api/agents/[agentId]/chat` or keep and fix it? | **Delete.** No UI or external consumer; it is a second write path that races the webhook. | Dead code plus a duplicate mutation path. Deleting removes the bug instead of patching it. |
| C | **D9:** complete RLS coverage only, or fully activate RLS? | **Coverage only.** Activation needs a dedicated non-owner DB role + `FORCE` + per-request `SET LOCAL`; doing it now would return zero rows and break the app. | Documented 3-step activation path in `tenant-context.ts`. Coverage is the part that is code. |
| D | **D6:** reply to media messages, or leave them for a human? | **One short reply, debounced, no agent turn.** Store the message for the inbox. | Silence loses the customer; an LLM answer to "[image]" is worse. |

If you disagree with any of these, say so before that phase starts - the plan below assumes the recommended column.

---

## 4. Phase 1 - Agent turn (D1, D3, D4)

### D1 - Remove the transaction-held turn lock; bound LLM latency

**Problem.** `processInboundWithAgent` (`agent-loop.ts:199`) holds a Postgres transaction for the whole turn,
including the LLM HTTP call, with a 120s timeout and no fetch timeout. Turns pin a pooled connection for minutes;
9 concurrent chats exhaust the pool; slow turns die with "Transaction already closed" and the customer gets the
canned apology (21 times in production).

**Fix.**

1. **Schema** - `Conversation` gains two nullable columns:
   - `turnLockId String?` - lease owner token (uuid), so a stale turn cannot release someone else's lease.
   - `turnLockedAt DateTime?` - lease start.
2. **New `src/lib/turn-lock.ts`** - two raw statements, no transaction:
   ```sql
   -- acquire (returns 1 row affected, 0 = busy)
   UPDATE "Conversation"
   SET "turnLockId" = $1, "turnLockedAt" = NOW()
   WHERE id = $2 AND "tenantId" = $3
     AND ("turnLockedAt" IS NULL OR "turnLockedAt" < NOW() - INTERVAL '3 minutes')

   -- release (only the lease owner)
   UPDATE "Conversation"
   SET "turnLockId" = NULL, "turnLockedAt" = NULL
   WHERE id = $1 AND "tenantId" = $2 AND "turnLockId" = $3
   ```
   The 3-minute stale window is safe because the turn itself is capped at 90s (step 3).
3. **`src/services/llm-runtime.ts`**
   - `LLM_TIMEOUT_MS = 30_000` via `AbortSignal.timeout`.
   - One retry on `429` and `5xx` (immediate, no backoff loop).
   - `TURN_BUDGET_MS = 90_000`: check the deadline before each tool iteration; on expiry return
     `{ truncated: true }` so the existing "Mohon tunggu..." path handles it.
4. **`src/lib/agent-loop.ts`**
   - Replace `prisma.$transaction(...)` with `acquireTurnLease` / `releaseTurnLease` in `try/finally`.
   - If the lease is busy: **return without replying** - the lease holder drains the new message (step 5).
   - **Drain loop (max 3 iterations):** after each turn, read the newest inbound message. If it is newer than the
     turn's trigger and no outbound message exists after it, run another turn for it. This is what prevents a
     message that arrived mid-turn from going unanswered - the failure mode a naive "skip if busy" would create.
   - Drop the `body` parameter from `processInboundWithAgent`; read the trigger message from the DB inside the
     drain loop (single source of truth). `runAgentReply` keeps its explicit `body` for the dashboard test path
     if that path survives (it does not - see D5).
5. **Delete** the `$transaction` + `pg_advisory_xact_lock` pattern entirely. No advisory locks remain.

**Files:** `prisma/schema.prisma`, new `src/lib/turn-lock.ts`, `src/lib/agent-loop.ts`,
`src/services/llm-runtime.ts`, `src/pages/api/webhooks/whatsapp.ts`, `src/services/baileys.ts` (call signature).

**Migration:** additive columns only (`ALTER TABLE "Conversation" ADD COLUMN ...`).

**Verification.**
- Two messages 1s apart on one conversation -> two replies, correct order, no duplicate.
- 10 concurrent conversations against a deliberately slow provider -> no `agent_error`, no long
  `idle in transaction` in `pg_stat_activity`.
- Provider unreachable -> one canned fallback, turn ends under 90s.
- Kill the process mid-turn -> the lease expires after 3 minutes and the next message is served.

**Risk:** if the drain loop has a bug, a message could be answered twice. Mitigated by the "no outbound after the
inbound" check and the 3-iteration cap.

---

### D3 - Inbound idempotency, and ACK before writes

**Problem.** The webhook awaits Contact + Conversation + Message writes before the 200, and `waMessageId` is not
unique. Meta redeliveries are stored again and trigger the agent again. 11 duplicate groups already exist.

**Fix.**

1. **Schema** - partial unique index (Prisma cannot express it; raw SQL in the migration):
   ```sql
   CREATE UNIQUE INDEX "Message_tenantId_waMessageId_key"
   ON "Message" ("tenantId", "waMessageId")
   WHERE "waMessageId" IS NOT NULL;
   ```
2. **Manual, approved pre-step** (destructive, run once before the deploy - NOT inside the migration):
   ```sql
   -- keep the earliest row of each duplicate group
   DELETE FROM "Message" m
   USING "Message" keep
   WHERE m."waMessageId" = keep."waMessageId"
     AND m."tenantId" = keep."tenantId"
     AND m."waMessageId" IS NOT NULL
     AND (m."createdAt" > keep."createdAt"
          OR (m."createdAt" = keep."createdAt" AND m.id > keep.id));
   ```
   Expected on production: 11 rows deleted, all `[unsupported]` inbound. Verify the count before and after.
3. **`src/lib/inbox.ts`** - `recordInboundMessage` catches `P2002` and returns the existing row;
   `ingestInboundMessage` returns `{ message, conversationId, duplicate }`. `conversation.new` still fires only
   when the conversation was created.
4. **`src/pages/api/webhooks/whatsapp.ts`** - reorder: parse -> resolve channel -> verify HMAC -> **200 ACK** ->
   `void ingestAndProcess(...)` per message. The channel lookup stays before the ACK because the HMAC needs the
   channel secret; it is one indexed query.
5. **`src/services/baileys.ts`** - same duplicate handling; skip the agent turn on duplicates.

**Files:** `prisma/schema.prisma` (comment only), migration, `src/lib/inbox.ts`,
`src/pages/api/webhooks/whatsapp.ts`, `src/services/baileys.ts`.

**Verification.**
- Replay the same webhook body twice -> 1 Message row, 1 agent reply.
- Duplicate `[unsupported]` events no longer trigger the agent.
- ACK latency stays under 1s with a warm Neon compute.

**Risk:** a crash between ACK and ingest loses that message (Meta will not retry after a 200). This is the standard
Meta-recommended trade-off; the alternative is duplicate processing under load. Documented in the route comment.

---

### D4 - History window: newest 20, and stop duplicating the trigger message

**Problem 1.** `agent-loop.ts:96` fetches `orderBy: asc, take: 20` - the **oldest** 20 messages in the window.
**Problem 2 (found while planning).** The trigger message is already in the history rows *and* is appended again as
`userMessage`, so the model sees the customer's last message twice.

**Fix.**
- Fetch `orderBy: { createdAt: "desc" }, take: 20`, then reverse to chronological order.
- Exclude the trigger message from the history rows (`id: { not: triggerMessageId }`) and append it once as the
  user message. `processInboundWithAgent` already knows the message id after D3.
- Keep the fresh-window context prefix as-is (server-generated, one line).

**Files:** `src/lib/agent-loop.ts`.

**Verification.**
- 25-message conversation -> the agent answers the latest message, not the first.
- Temporary prompt log (env-guarded) shows the trigger body exactly once.

**Risk:** none material; this is a query + mapping correction.

---

## 5. Phase 2 - Customer scope, dead endpoint, paging (D2, D5, D10a)

### D2 - Customer-specific data scope in tools

**Problem.** `customer.read`, `customer.update`, `order.list`, `order.read` accept model-supplied identity and only
filter by tenant. A customer can request another customer's contact or order.

**Fix.**

1. **New `src/tools/scope.ts`** - one helper, no abstraction beyond what 4 call sites need:
   ```ts
   // Agent path: identity is the conversation. HTTP gateway path: caller is
   // session-authenticated and may pass an explicit phone.
   export function resolveScopedPhone(ctx: ToolContext, requested?: string): string | null
   ```
   Returns `ctx.customerPhone` when `ctx.conversationId` is set; `null` when a different phone was requested;
   `requested` when there is no conversation context.
2. **`customer.read` / `customer.update`** - use the helper; on `null` return
   `{ success: false, errorCode: "PERMISSION_DENIED" }`.
3. **`order.read`** - in the agent path, add `customerPhone: ctx.customerPhone` to the `where`; a foreign order
   returns `NOT_FOUND`.
4. **`order.list`** - in the agent path:
   - reject a `phone` that differs from the conversation phone;
   - when filtering by `email`, only accept contacts whose phone equals the conversation phone;
   - when filtering by `orderNumber`, add `customerPhone: ctx.customerPhone` to the `where`.
5. **`order.list` paging (D10a)** - add `skip: (page - 1) * take`; keep the 25-row cap.

**Files:** new `src/tools/scope.ts`, `src/tools/customer.ts`, `src/tools/order.ts`.

**Verification.**
- "cek orderan nomor <other customer>" -> refusal / empty, no data leak.
- "simpan email saya ..." -> updates only the conversation's contact.
- Order number belonging to another phone -> `NOT_FOUND`.
- Dashboard HTTP gateway with a session and explicit phone still works.
- Orders page 2 returns different rows than page 1.

**Risk:** legitimate cross-number cases now need a human. Accepted per Decision A.

---

### D5 - Delete the unused chat endpoint

**Problem.** `/api/agents/[agentId]/chat` is referenced by no UI or external consumer. Its advisory lock is
ineffective (root `prisma` inside the transaction), so it can double-execute writes.

**Fix.** Delete `src/pages/api/agents/[agentId]/chat.ts`; remove the two comments that reference it
(`agent-loop.ts:33`, and the M4 note). Keep `runAgentReply` exported for internal use.

**Verification.** `grep -r "agents/.*/chat" src` returns nothing; build passes; route 404s.

**Risk:** if some external script used it, it breaks. Nothing in the repo does. Decision B confirms.

---

## 6. Phase 3 - Inbound content and inbox stream (D6, D7)

### D6 - Classify non-text messages; never send them to the LLM

**Problem.** Cloud API turns any non-text payload into `[image]` / `[unsupported]` and the agent answers that
string. Baileys drops media without a caption silently.

**Fix.**

1. **Types** (`src/types/whatsapp.ts`) - add `kind: "text" | "media" | "other"` to `ParsedInbound` and
   `InboundMessage`. Keep `body` as the display placeholder (`[image]`, `[sticker]`, ...).
2. **Cloud API** (`src/services/whatsapp.ts`) - classify by `msg.type`:
   - `text` -> `text`;
   - `image | video | document | audio | sticker` -> `media`;
   - everything else (`reaction`, `unsupported`, `system`, ...) -> `other`.
   - An image **with a caption** is `text` and uses the caption as the body.
3. **Baileys** (`src/services/baileys.ts`) - `extractBody` returns `{ body, kind }`; media without a caption
   becomes `[image]` / `[video]` / `[document]` with `kind: "media"` instead of being dropped.
4. **Webhook + socket** - after ingest:
   - `text` -> normal agent turn;
   - `media` -> **no agent turn**; one short reply, debounced to at most once per 10 minutes per conversation
     (`Conversation.settings.lastNonTextReplyAt`). Message: "Kirim pesan teks ya, Kak, supaya saya bisa bantu."
   - `other` -> store only, no reply (a reaction does not need an answer).
5. The reply goes through `sendAgentMessage` (existing 24h-window + audit behavior), action
   `conversation.non_text_reply`. The conversation stays unassigned so the owner still sees the media in the inbox.

**Files:** `src/types/whatsapp.ts`, `src/services/whatsapp.ts`, `src/services/baileys.ts`,
`src/pages/api/webhooks/whatsapp.ts`, `src/lib/agent-outbox.ts` (helper).

**Verification.**
- Uncaptioned image -> 1 polite reply, no LLM call, no `[image]` in any LLM input.
- Image with caption -> treated as normal text.
- Reaction / unsupported -> stored, no reply.
- 3 images in 30s -> 1 reply (debounce).

**Risk:** media content itself is still not understood (out of scope). The reply sets expectations instead of
guessing.

---

### D7 - SSE stream must not miss same-second messages

**Problem.** `stream.ts` filters `createdAt > lastSeen` while inbound timestamps are second-precision, so a second
message in the same second is never emitted (and nothing triggers the client's refetch).

**Fix.**
- Query with `gte: lastSeen - 2s` (covers second precision + clock skew), keep a bounded `Set` of already-emitted
  message ids (cap 200) and emit only unseen rows. Advance `lastSeen` to the max `createdAt` seen.
- Keep the 3s poll and the 15s heartbeat. No client change needed: the panel refetches on every event.

**Files:** `src/pages/api/dashboard/inbox/stream.ts`.

**Verification.** Two messages in the same second appear live without a manual refresh; no duplicate refetch loop
(the set stops re-emission).

**Risk:** none; the client refetch is idempotent.

---

## 7. Phase 4 - DB hardening (D8, D9, D10b)

### D8 - HNSW index on knowledge embeddings

**Problem.** `findSimilar` orders by cosine distance with no vector index - a sequential scan per query.

**Fix.** Migration:
```sql
CREATE INDEX "KnowledgeEmbedding_embedding_hnsw_idx"
ON "KnowledgeEmbedding" USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```
Keep the `tenantId` filter in `findSimilar`. Note in the code comment: HNSW is post-filtered, so at large tenant
sizes a filtered search can return fewer than `limit` rows; `SET hnsw.ef_search` is the tuning knob if that happens.

**Verification.** `EXPLAIN ANALYZE` on the `findSimilar` query shows an index scan. `knowledge.search` still
returns the seeded policy at a similar similarity score.

**Risk:** index build takes a lock briefly; with 4 rows it is instant.

---

### D9 - Complete RLS coverage (still inert)

**Problem.** 10 tenant-scoped tables have no policy: `Deal`, `DealStageHistory`, `Pipeline`, `Stage`, `Scenario`,
`ScenarioRun`, `ScenarioRunStep`, `SourceRow`, `ConversationRead`, `InventorySnapshot`.

**Fix.** One idempotent migration that covers every current table with a `tenantId` column and no policy:
```sql
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM information_schema.columns col
                  WHERE col.table_schema = 'public' AND col.table_name = c.relname
                    AND col.column_name = 'tenantId')
      AND NOT EXISTS (SELECT 1 FROM pg_policies p
                      WHERE p.schemaname = 'public' AND p.tablename = c.relname)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING ("tenantId" = current_setting(''app.current_tenant_id'', true)) WITH CHECK ("tenantId" = current_setting(''app.current_tenant_id'', true))',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;
```
Do **not** add `FORCE` and do not switch the app role - activation stays the documented 3-step path.
Add a comment in the migration: new tenant tables require re-running this block (or extending the RLS migration).

**Verification.** `select count(*) from pg_policies` equals the number of tables with a `tenantId` column (29 at
the time of writing). App behavior unchanged (owner bypasses).

**Risk:** none today; the policies are inert by design.

---

### D10b - Pipeline uniqueness

**Problem.** `getOrCreatePipeline` is check-then-create with no constraint; two concurrent first-turns can create
two pipelines.

**Fix.**
- Schema: `Pipeline` gains `@@unique([tenantId])`; drop the now-redundant `@@index([tenantId])`.
- `getOrCreatePipeline` becomes an `upsert({ where: { tenantId }, create: { ...stages }, update: {} })`, then read.
- Migration: **pre-check** `SELECT "tenantId", count(*) FROM "Pipeline" GROUP BY 1 HAVING count(*) > 1;`.
  Production has one pipeline. If a self-hosted DB has duplicates, the migration must fail loudly and the operator
  merges them manually (auto-deleting would cascade stages and is blocked by `Deal.stageId` Restrict).

**Verification.** Two concurrent `getOrCreatePipeline` calls produce one pipeline; the pipeline page still renders.

**Risk:** migration fails on a DB with duplicate pipelines - intentional, with a documented manual step.

---

## 8. Phase 5 - Hygiene (D10c-f)

### D10c - Google credentials out of `Tenant.settings`

**Problem.** Access + refresh tokens live in a config JSON blob that several routes read-merge-write. Any future
route that returns `settings` leaks credentials.

**Fix (two releases, no downtime).**
1. New model `TenantCredential` (`tenantId @unique`, `provider`, `accessToken`, `refreshToken`, `expiryDate`,
   `email`) + migration that **copies** existing tokens from `Tenant.settings.googleSheets`.
2. `src/lib/google-connect.ts` reads/writes the table; `settings.googleSheets` is no longer touched.
3. After the deploy is verified, a second migration removes the key:
   `UPDATE "Tenant" SET settings = settings - 'googleSheets' WHERE settings ? 'googleSheets';`
   (destructive, run only after verification - separate release).

**Verification.** Connect and disconnect a Google account; `select settings from "Tenant"` contains no token;
Sheets sync still works.

**Risk:** if step 3 runs before the new code is live, tokens are lost and the owner must reconnect. The two-release
sequencing prevents that.

---

### D10d - Cron lock for multi-instance safety

**Problem.** `startScheduler()` runs from the health endpoint; a second instance would duplicate Sheets syncs,
scenario runs and session-close messages.

**Fix.** New `SystemLock` model (`key @id`, `lockedUntil`) + `src/lib/system-lock.ts` with a single
`withSystemLock(key, ttlSeconds, fn)` built on:
```sql
INSERT INTO "SystemLock" (key, "lockedUntil", "updatedAt")
VALUES ($1, NOW() + ($2 || ' seconds')::interval, NOW())
ON CONFLICT (key) DO UPDATE
SET "lockedUntil" = EXCLUDED."lockedUntil", "updatedAt" = NOW()
WHERE "SystemLock"."lockedUntil" < NOW()
RETURNING key
```
Wrap each cron body (`sheets-sync`, `scenario-tick`, `session-close`) in its own lock. One instance today means no
behavior change; a second instance becomes safe.

**Verification.** A script acquires the lock twice: the second call is skipped. Cron logs show one run per tick.

**Risk:** if a tick crashes without releasing, the TTL expires and the next tick proceeds (lock is a lease, not a
mutex held forever).

---

### D10e - Event bus without `as` casts

**Problem.** `src/lib/events.ts` uses three `as` casts to satisfy `EventEmitter`'s untyped listener signature.

**Fix.** Replace the `EventEmitter` with three small typed channels (one per event) and an object export:
```ts
class TypedChannel<T> {
  constructor(private readonly schema: ZodType<T>) {}
  private readonly handlers: Array<(p: T) => void> = [];
  on(h: (p: T) => void): void { this.handlers.push(h); }
  emit(raw: unknown): void { /* safeParse, then call handlers, catch per handler */ }
}
export const events = {
  conversationNew: new TypedChannel(conversationNewSchema),
  orderPurchased: new TypedChannel(orderPurchasedSchema),
  conversationTagged: new TypedChannel(conversationTaggedSchema),
};
```
Call sites (3 emit, 3 subscribe) change mechanically. No casts, no `EventEmitter`, same fire-and-forget semantics.

**Verification.** Build + lint; a scenario still triggers on a new conversation and on a purchase.

**Risk:** low; behavior is identical.

---

### D10f - Encoding guard + mojibake strings

**Problem.** Corrupted UTF-8 (`â€”`) sits in three user/model-visible strings
(`scenario-engine.ts:345` owner-facing error, `:617` AI-node prompt, `seed.ts:109` agent instructions).

**Fix.**
- Correct the three strings (plain `-` instead of the em dash).
- Add `scripts/check-encoding.mjs` (no deps): fails if any `src/**` or `prisma/**` `.ts/.tsx/.prisma` file contains
  `â€` or `Ã`. Wire it as `npm run check:encoding` and run it in the verification flow.
- Leave the remaining ~46 occurrences in comments to a separate mechanical pass (they are cosmetic and touching 49
  lines adds diff noise to this fix). **If you want them all, say so and I will include the sweep.**

**Verification.** `npm run check:encoding` passes; the scenario error message and AI prompt render clean text.

**Risk:** none.

---

### D10g - Deployment documentation (not a code defect)

**Correction to the deep dive.** I earlier called the compose Postgres "dead weight". That is true for the current
Render + Neon deployment but **wrong for the product**: self-hosting with a local Postgres is the PRD's deployment
model. Do not delete it. Instead, document the two supported modes in `README.md` and as comments in
`docker/docker-compose.yml`:
- **Mode A (self-host):** compose Postgres (`postgres` service) + app.
- **Mode B (managed):** `DATABASE_URL` points at Neon (or any managed Postgres); the `postgres` service and
  `depends_on` are unused.

**Files:** `README.md`, `docker/docker-compose.yml`, `.env.production.example`.

**Verification.** Docs only.

---

## 9. Migration plan

| Order | Migration | Contents | Destructive? |
|---|---|---|---|
| 0 | (manual) | Dedupe 11 duplicate `Message` rows | **Yes - needs explicit approval** |
| 1 | `20261101000000_turn_lease_idempotency_pipeline` | Conversation lock columns; partial unique on Message; Pipeline unique | No (fails if dupes exist) |
| 2 | `20261101000100_rls_coverage_hnsw` | Dynamic RLS coverage block; HNSW index | No |
| 3 | `20261101000200_tenant_credential` | `TenantCredential` table + copy from settings | No (copy only) |
| 4 | `20261101000300_system_lock` | `SystemLock` table | No |
| 5 | later release | Remove `googleSheets` from settings | **Yes - after verification** |

Execution rules:
1. **Branch the Neon database before migrating** (`create_branch` from `production`) so rollback is a branch switch,
   not a restore.
2. `npx prisma migrate deploy` runs automatically on container start. Apply to the branch first, verify, then
   production.
3. Prisma schema and SQL must match (the partial unique index and HNSW index are SQL-only; document them as
   comments in `schema.prisma`, like the existing partial index on `Stage`).
4. No `migrate dev` against production, ever.

---

## 10. Verification matrix

| Check | Command / action | Applies to |
|---|---|---|
| Type + build | `npm run build` | every phase |
| Lint | `npm run lint` | every phase |
| Encoding | `npm run check:encoding` | Phase 5+ |
| Two rapid messages | send 2 messages 1s apart on one conversation | D1, D3 |
| Concurrency | 10 conversations against a slow provider; inspect `pg_stat_activity` | D1 |
| Provider down | point `LLM_BASE_URL` at an invalid host | D1 |
| Replay webhook | POST the same signed body twice | D3 |
| Cross-customer | ask the agent for another phone's order | D2 |
| Long conversation | 25 messages, confirm the agent answers the latest | D4 |
| Media | image with and without caption; reaction | D6 |
| Same-second messages | 2 messages within 1s, watch the inbox | D7 |
| Vector plan | `EXPLAIN ANALYZE` the `findSimilar` query | D8 |
| RLS count | `select count(*) from pg_policies` | D9 |
| Pipeline race | 2 concurrent `getOrCreatePipeline` calls | D10b |
| Google connect | connect + disconnect + Sheets sync | D10c |
| Cron lock | acquire twice in a script | D10d |

---

## 11. Rollback

- **Code:** revert the phase commit. Each phase is one commit.
- **DB:** migrations 1-4 are additive (columns, indexes, tables). Leaving them after a code revert is harmless.
- **Destructive steps** (dedupe, settings key removal) are manual and only run after verification; the Neon branch
  from step 1 is the rollback point.
- **No feature flags.** The turn lease is inert if the new code is reverted (nullable columns, unused).

---

## 12. Explicitly out of scope

- Media understanding (vision/transcription) - D6 only stops the wrong behavior.
- PDF/DOCX knowledge ingestion.
- RLS activation (needs a dedicated DB role; infra, not code).
- Per-source `customerVisible` flag (`source.search` exposing staff data).
- Fixing the `Tenant.settings` read-merge-write race for templates/priority (D10c removes the worst consequence).
- Inbox UI redesign / refetch-on-every-event optimization.
- Owner-ops agent (still deferred per the 2026-10-25 decision).

---

## 13. Definition of done

Per phase:
1. `npm run build` passes.
2. `npm run lint` passes.
3. The phase's verification rows in section 10 pass.
4. `Changelogs.md` updated; `package.json` version bumped (2.0.0 on the first phase).
5. `docs/2026-10-31-project-deep-dive.md` marks the fixed defects as closed with the commit hash.
6. One conventional commit per phase, pushed.

---

## 14. Checklist

- [x] Decisions A-D confirmed
- [x] Phase 1: D1 turn lease + LLM timeout
- [x] Phase 1: D3 idempotency + ACK-first
- [ ] Phase 1: D4 newest-20 history, no duplicate trigger
- [ ] Phase 2: D2 customer scope guard
- [ ] Phase 2: D5 delete chat route
- [ ] Phase 2: D10a order paging
- [ ] Phase 3: D6 media classification + debounced reply
- [ ] Phase 3: D7 stream cursor
- [ ] Phase 4: D8 HNSW index
- [ ] Phase 4: D9 RLS coverage
- [ ] Phase 4: D10b pipeline unique
- [ ] Phase 5: D10c credentials table
- [ ] Phase 5: D10d cron lock
- [ ] Phase 5: D10e event bus
- [ ] Phase 5: D10f encoding guard
- [ ] Phase 5: D10g deployment docs
