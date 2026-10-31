# CSQ — Project Deep Dive

**Date:** 2026-10-31
**Scope:** Full read of the codebase (`src/`, `prisma/`, `docker/`), the PRD/SRS/SDD, and the live Neon database
(`winter-flower-03790042`, branch `production`, aws-ap-southeast-1, PG 18.6, 11 MB).
**Purpose:** One document that explains what this system actually is today, what is proven, and what is broken —
so future work starts from evidence instead of assumption.

---

## 1. What CSQ is, in one paragraph

A self-hosted, multi-tenant platform that puts an AI customer-service agent on a UMKM's existing WhatsApp number.
The owner connects the data they already have (manual entry, Excel/CSV, Google Sheets), adds FAQs/policies,
picks exactly which tools the agent may use, and deploys. The agent reads live business data through a permission-checked
Tool Gateway, can perform a narrow set of writes when explicitly granted, escalates to a human when it cannot act,
and records everything it does. The product promise is *"your business doesn't need to change how it works"* — enforced
by the rule **read by default, write by permission, act by policy**.

---

## 2. Architecture as built

### 2.1 Stack reality

| Layer | PRD said | Actually shipped |
|---|---|---|
| App | Next.js **Pages Router** | Next.js 14.2 Pages Router, one process |
| DB | Postgres + Prisma + pgvector | Neon Postgres 18, pgvector 0.8.6, Prisma 5.22 |
| Agent runtime | OpenClaw per-tenant cells | **Removed 2026-10-25.** Direct OpenAI-compatible loop in `src/services/llm-runtime.ts` |
| Channel | WhatsApp Cloud API + Baileys | Both implemented behind `WhatsAppProvider` (`src/lib/whatsapp-provider.ts`) |
| Queue | none | none — `node-cron` in-process, `EventEmitter` for scenario triggers |
| Deploy | Docker Compose + Nginx + Certbot | Compose files exist; the live deployment is Render (Singapore) against Neon |

The OpenClaw removal is the biggest architectural change since the PRD. The PRD still describes OpenClaw as the
runtime (sections 4.3, 23A, 26); the code no longer does. Everything that mattered about OpenClaw (per-agent tool
policy, workspace isolation) now lives in `AgentCapability` + `executeTool`.

### 2.2 Request paths

**A. Inbound customer message (the core loop)**

```
Meta Cloud API ──POST──▶ /api/webhooks/whatsapp
                           │ 1. HMAC verify (fail-closed, timingSafeEqual)
                           │ 2. resolve Channel by config.phoneNumberId → tenantId
                           │ 3. ingestInboundMessage() → Contact + Conversation + Message
                           │ 4. ACK 200
                           └─ void processInboundWithAgent()   (fire-and-forget)
                                 │ pg_advisory_xact_lock(hashtext(conversationId))
                                 │ runAgentReply()
                                 │   ├─ stand down if human assigned / channel down / agent not ACTIVE
                                 │   ├─ replay ≤20 messages from last 1h
                                 │   ├─ buildSystemPrompt()  (bounded)
                                 │   └─ runConversation() ──▶ POST {LLM_BASE_URL}/v1/chat/completions
                                 │        └─ tool_calls → executeTool() → registry handler
                                 └─ sendAgentMessage() → provider send + Message row + AuditLog
```

Baileys replaces step 1–4 with an in-process socket (`src/services/baileys.ts`), then joins the same
`ingestInboundMessage` → `processInboundWithAgent` path.

**B. Dashboard** — `pages/dashboard/*` (SSR-guarded by `withAuth`), data via `/api/dashboard/*` (session → `requireTenant`
→ Prisma). OWNER gates configuration; OWNER+STAFF gates inbox/pipeline/scenarios.

**C. Scenario automation** — owner-built flows (`scenario-engine.ts`, 910 lines). Triggers: new conversation, purchase,
tag added, schedule, no-reply. Runs are persisted (`ScenarioRun` + per-node `ScenarioRunStep`), resumable on a
`Wait` node via a 1-minute cron tick. Fire-and-forget: the scenario injects messages, the AI agent owns replies.

### 2.3 Where the important logic lives

| Concern | File |
|---|---|
| Agent turn orchestration, lock, history window | `src/lib/agent-loop.ts` |
| LLM loop, tool-call handling, iteration cap | `src/services/llm-runtime.ts` |
| System prompt (bounded, safety rules) | `src/lib/prompt-builder.ts` |
| Tool registry | `src/tools/index.ts` + one file per domain |
| Permission resolution | `src/lib/permissions.ts` |
| Tool execution + approval queue | `src/tools/execute.ts` |
| Outbound send + 24h window + audit | `src/lib/agent-outbox.ts` |
| Ingest, assignment, human reply | `src/lib/inbox.ts` |
| pgvector (the only raw vector SQL) | `src/lib/vector.ts` |
| Data-source priority | `src/lib/source-priority.ts` |
| Scenario engine | `src/lib/scenario-engine.ts` |
| Cron (sheets sync, scenario resume, session close) | `src/services/scheduler.ts` |

---

## 3. Live state — what the database says

This is not a demo shell; it has served real customers.

| Fact | Value |
|---|---|
| Tenant | `Toko Kopi Nusantara` (1 tenant, 1 OWNER user `admin@tokokopi.id`) |
| Channel | Cloud API **CONNECTED**, phone_number_id `1277448755459529`; Baileys DISCONNECTED |
| Conversations / messages | 18 / 212 (last activity 2026-10-28) |
| Message mix | 97 inbound customer, 95 agent, 15 scenario, 5 human |
| Products / inventory | 3 products, stock 8 / 5 / 8 |
| Orders | 2 |
| Knowledge | 4 rows (2 FAQ, 2 POLICY), all embedded at 1024 dims |
| Data sources | "GPT" (Google Sheets, `dataType=staff`, ACTIVE, 52 rows, last sync 2026-10-29); "Google Sheets" (produk, INACTIVE) |
| Agent | `Kopi Nusantara CS`, ACTIVE, 16 capabilities granted |
| Pipeline | 1 pipeline, 6 stages (Baru → Kalah), 5 deals, 21 stage changes |
| Scenarios | 1 ACTIVE (`Opening Scenario`), 2 DRAFT, 8 runs / 24 steps |
| Audit log | 234 rows — every tool call, reply, handoff, capability change |
| RLS | 19 policies on 19 tables, **not enforced** (owner role bypasses) |
| pgvector | `KnowledgeEmbedding.embedding vector(1024)`, **no HNSW/IVFFlat index** |

### What the traffic shows about quality

- The agent answers in natural Indonesian, uses tools (`customer.read`, `product.search`, `order.list`,
  `knowledge.search`, `deal.setStage`), and hands off to a human when asked ("hubungkan saya dengan live agent" →
  `conversation.handoff` → conversation assigned to the owner).
- 21 `conversation.agent_error` audit rows: customers received the canned apology
  *"Maaf, sistem kami sedang mengalami gangguan sebentar…"* 21 times.
- 11 inbound `waMessageId` values appear **twice** — Meta redeliveries that were stored and processed twice.
- One inbound message body is literally `[image]`; 11 duplicates are `[unsupported]`.

---

## 4. The agent turn, precisely

1. **Stand-down checks** — human assignee, channel not CONNECTED, agent not ACTIVE (`agent-loop.ts:44-84`).
2. **History** — messages from the last 60 minutes, `isInternal: false`, mapped INBOUND→`user`, outbound→`assistant`.
3. **Fresh-window context** — on the first message of a window, one bounded line of facts (name, email, order count,
   last order, pipeline stage). Not a replay; a summary from the source of truth.
4. **System prompt** (`prompt-builder.ts`) — persona, writing style (emoji whitelist, no em-dashes), scope guard,
   owner instructions, ≤10 BUSINESS_INFO rows, ≤10 HIGH memories, safety rules, pipeline stage names,
   identity/handoff rules. **FAQ and POLICY are never in the prompt** — they are fetched by `knowledge.search`.
   This is the one rule most often violated by agent platforms, and here it is correct.
5. **LLM loop** — up to 10 iterations; tools are executed in-process; malformed tool JSON is fed back as a
   `role:"tool"` error so the model can self-correct.
6. **Permission** — `AgentCapability` row for `(agentId, tool)` wins, else the tool's `defaultPermission`
   (reads allowed, writes denied + approval).
7. **Outcome** — `ok` / `permission_denied` (audited, never executed) / `approval_required` (Approval row created,
   never executed) / validation/not-found/internal error.
8. **Send** — `sendAgentMessage` enforces the Cloud API 24h window (free-form inside, approved template outside,
   skip+audit if no template), converts markdown to WhatsApp formatting, persists the Message and the audit row.

**The safety moment is enforced in code, not prompt text:** `product.update` defaults to
`allowed:false, requiresApproval:true`; a denied call is audited and never executed.

---

## 5. What is genuinely solid (verified, not assumed)

- **Bounded context.** Prompt size does not grow with tenant knowledge. Retrieval is on demand.
- **Tool Gateway discipline.** Every tool is tenant-scoped, agent-scoped, Zod-validated, permission-checked, audited.
  `order.create`/`order.cancel` use `SELECT … FOR UPDATE` on inventory rows inside a transaction — no oversell.
- **Webhook security.** HMAC-SHA256 over the raw body, constant-time compare, fail-closed when no secret exists,
  tenant resolved from the channel (never from the sender), multi-`phone_number_id` payloads rejected.
- **No `as any` / `as unknown`** anywhere. External boundaries (WhatsApp payloads, LLM responses, spreadsheet rows,
  JSON columns) are Zod-parsed.
- **Role enforcement.** 100+ `requireRole` call sites; business-data mutations are OWNER-only.
- **Approval loop closes.** Approved action is re-validated, executed, audited with before/after, and the result is
  sent back to the originating customer conversation.
- **Data authority.** Per-source `InventorySnapshot` + tenant `sourcePriority` resolution; Excel and Sheets both go
  through `applyImport` (the earlier C2 defect is fixed).
- **Honest documentation of RLS.** `tenant-context.ts` states plainly that RLS is defined-but-inert and gives the
  3-step activation path. No false claims of a second isolation layer.
- **Ingestion limits.** 10k-row cap with an owner-facing error instead of OOM.

---

## 6. Defects found in this pass (ranked)

These are **new** — not repeats of the 2026-08-22 gap review (whose findings are closed).

### D1 — CRITICAL: the agent turn holds a DB transaction across the LLM call

`processInboundWithAgent` wraps the entire turn — including the LLM HTTP round-trips — in
`prisma.$transaction(..., { timeout: 120_000 })` (`agent-loop.ts:199-205`). The same pattern exists in
`api/agents/[agentId]/chat.ts:59-70`.

Consequences, all observed in production:

- `Transaction already closed … 120419 ms / 305569 ms / 349850 ms passed` — turns exceeded the 120s budget
  because **the LLM fetch has no timeout** (`llm-runtime.ts:57-76`).
- `Timed out fetching a new connection from the connection pool (limit: 9)` — each active turn pins one pooled
  connection for the whole LLM latency, so ~9 concurrent conversations starve the whole app (dashboard included).
- 21 customer-facing error fallbacks.

**Fix:** stop using a transaction as a lock. Either (a) a lease column on `Conversation`
(`turnLockedAt`/`turnLockId`, atomic `updateMany` where null or stale, released in `finally`), or (b) a
`ConversationTurn` lock row. Then add an `AbortSignal.timeout(30_000)` to the LLM fetch and a 1-retry policy for
429/5xx. The lock must not span an external call.

### D2 — CRITICAL: customer data scope is tenant-wide, not customer-scoped

`customer.read` and `customer.update` accept an explicit `phone` from the model and use
`p.phone ?? ctx.customerPhone` (`tools/customer.ts:49, 97`). `order.list` accepts `phone`/`email` filters
(`tools/order.ts:141-154`). A customer can therefore ask *"cek orderan nomor 0812xxxx"* and the agent will read
another customer's name, email, notes, orders, and totals.

This directly violates PRD §18.1 ("enforce customer-specific data scope server-side"). The comment in
`customer.ts` claims the phone "comes from ctx.customerPhone, never from the model" — that is not what the code does.

**Fix:** in the agent path (`ctx.conversationId` present), reject any `phone` that differs from `ctx.customerPhone`.
Keep the explicit-phone path only for the session-authenticated HTTP gateway.

### D3 — HIGH: no inbound idempotency, and the ACK waits on DB writes

The webhook `await`s `ingestInboundMessage` for every message **before** sending 200
(`api/webhooks/whatsapp.ts:188-206`). Three Neon round-trips per message can exceed Meta's 5s budget under load,
which triggers Meta retries. `Message.waMessageId` has no unique constraint and no dedup check, so a redelivery is
stored again and **runs the agent again**.

Evidence: 11 duplicate `waMessageId` groups in the live DB, all 3–9s apart, all `[unsupported]` media events.

**Fix:** unique index on `(tenantId, waMessageId)` (partial, where not null) + `createMany({ skipDuplicates })`
or catch P2002 and skip the agent turn. ACK first, then ingest.

### D4 — HIGH: the history window replays the *oldest* 20 messages

`agent-loop.ts:96-105` uses `orderBy: { createdAt: "asc" }, take: 20`. The comment and the changelog both say
"newest 20". On any conversation with >20 messages in an hour, the model gets the beginning of the hour and loses
the most recent context — the opposite of what a chat agent needs.

**Fix:** `orderBy: desc, take: 20`, then reverse before mapping.

### D5 — HIGH: the dashboard chat route's advisory lock does nothing

`api/agents/[agentId]/chat.ts:59-70` calls `prisma.$executeRaw` (the **root** client) inside the `$transaction`
callback instead of `tx.$executeRaw`. The lock is acquired on a different pooled connection in autocommit mode, so it
is released immediately. The M4 "fix" from the August review is ineffective; a dashboard test turn can still race a
live customer turn and double-execute `order.create`.

**Fix:** use `tx.$executeRaw` — or better, delete the endpoint (it has no UI consumer) and rely on the webhook path.

### D6 — HIGH: non-text messages are fed to the LLM as text

Cloud API maps any non-text payload to `[${msg.type}]` (`services/whatsapp.ts:36`) — so `[image]`, `[sticker]`,
`[audio]`, `[unsupported]` become the customer's message and the agent replies to that string. Baileys does the
opposite: media without a caption yields an empty body and is silently dropped (`baileys.ts:77-96`).

UMKM customers send product photos and transfer screenshots constantly. Today: Cloud API gets a nonsense reply,
Baileys gets silence.

**Fix:** persist non-text messages with a typed placeholder and **do not run the agent turn** on them; instead send
one template-style reply ("Kirim pesan teks ya, Kak") or hand off to a human. Media download/vision is a separate,
larger feature.

### D7 — MEDIUM: the inbox SSE stream can silently drop messages

`stream.ts:50-64` starts at `lastSeen = new Date()` and advances `lastSeen = m.createdAt` with a strict
`createdAt: { gt: lastSeen }` filter. Inbound `createdAt` is the **WhatsApp timestamp (second precision)**. Two
messages in the same second → the second one is never emitted, and the gap between the initial history fetch and the
stream connect is not covered.

**Fix:** use a monotonic cursor `(createdAt, id)` with `OR` semantics, or `gte` plus client-side id dedup.

### D8 — MEDIUM: no vector index

`findSimilar` orders by `embedding <=> $1` with no HNSW/IVFFlat index (`vector.ts:66-73`; `pg_indexes` confirms only
btree on `id`, `knowledgeId`, `tenantId`). Every knowledge query is a sequential scan over the tenant's embeddings.
Fine at 4 rows; wrong at 4,000.

**Fix:** `CREATE INDEX … USING hnsw (embedding vector_cosine_ops)` (or ivfflat with `lists`), plus keep the tenant
filter. Needs a migration and a rebuild-on-write path.

### D9 — MEDIUM: RLS coverage is incomplete even as a future layer

19 policies exist; **10 tenant-scoped tables have none**: `Deal`, `DealStageHistory`, `Pipeline`, `Stage`,
`Scenario`, `ScenarioRun`, `ScenarioRunStep`, `SourceRow`, `ConversationRead`, `InventorySnapshot`.
If RLS is ever activated with `FORCE`, those tables stay open.

**Fix:** add the policies in the same migration that activates RLS, generated from `information_schema` so new
tenant tables cannot be forgotten.

### D10 — LOW (batch these)

| Item | Where | Note |
|---|---|---|
| `order.list` pagination is broken | `tools/order.ts:163` | `take: min(10*page, 25)` with no `skip`; page 2 returns the first 20 rows again |
| Pipeline seeding race | `lib/pipeline.ts:46-68` | check-then-create with no unique constraint → two pipelines possible |
| Mojibake in user-visible strings | `scenario-engine.ts:345` ("Loop terlalu panjang â€” …"), `:617` (AI-node system prompt), `prisma/seed.ts:109` (agent instructions) | UTF-8 bytes were re-saved as CP1252; the corrupted em-dash now goes to the model and to the owner. ~49 occurrences total, most in comments |
| Google OAuth tokens in `Tenant.settings` JSON | `lib/google-connect.ts:76-85` | Plaintext access + refresh token in a config column. No API returns `settings` today, so no leak — but one future `select: { settings: true }` response becomes a credential leak. Move to a dedicated `TenantCredential` table (or encrypt) |
| Cron starts from the health endpoint | `api/health.ts:24` | Correct for exactly one instance. A second Render instance = duplicate Sheets syncs, duplicate scenario runs, duplicate session-close messages |
| `events.ts` uses `as` casts | `lib/events.ts:87,105,111` | Violates the no-`as` rule; bounded, but it is the only place left |
| Compose still defines a local Postgres | `docker/docker-compose.yml:58-81` | The live DB is Neon; the container is dead weight (and a second source of truth for operators) |

---

## 7. Product-level observations (not bugs, decisions to make)

1. **The "sacred safety moment" has softened.** PRD §21 step 8 expects the agent to *refuse* a price change because
   it lacks `product.update`. The live agent has `product.update` **allowed with approval**, so it will say
   "saya konfirmasi ke pemilik" and queue an approval instead of refusing. That is PRD §16 behavior, not §21 behavior.
   Decide which story the product tells — both are defensible, but the demo script and the PRD disagree.
2. **`source.search` exposes whatever the owner imported, including staff lists.** The live "GPT" source is
   `dataType=staff` with 52 rows, and `source.search` is allowed by default. A customer asking "siapa saja tim
   tokonya?" can get internal rows. Consider a per-source `customerVisible` flag.
3. **Knowledge is thin.** 4 rows (2 FAQ, 2 policy). The retrieval path works, but the product's value proposition
   ("teach it your business") is only as good as what the owner loads. No document upload (PDF/DOCX) exists yet —
   the PRD's `return-policy.pdf` ingestion path is not built; only manual text entry.
4. **Media is the biggest real-world gap.** See D6. This is the #1 reason a UMKM would abandon the agent in week one.
5. **No owner-ops agent.** Deliberately deferred (documented 2026-10-25); the schema already supports it.
6. **Scenario engine is ahead of the agent loop in robustness** (persisted runs, per-node steps, idempotent dedup keys)
   while the agent turn still uses a transaction-as-lock. Worth aligning.

---

## 8. Recommended next steps (in order)

1. **Fix the turn lock + LLM timeout (D1).** Highest severity, ~1 file, unblocks everything else. Verify with two
   rapid messages on one conversation and a forced slow provider.
2. **Close the cross-customer scope hole (D2).** Small diff in 2 tool files; add a regression check: ask the agent
   for another phone's order and confirm refusal.
3. **Inbound idempotency (D3).** Unique index + skip-on-duplicate. Prevents double replies and double orders.
4. **Fix the history window (D4) and delete or repair the chat route (D5).**
5. **Non-text handling (D6).** Placeholder + no agent turn + one clear reply.
6. **Vector index (D8) + RLS coverage (D9)** — cheap now, expensive later.
7. **Then** product work: document ingestion (PDF/DOCX), media understanding, per-source customer visibility.

Do **not** start new features before 1–5. The system is live with real customers, and the failure mode is
"customer asks a question, gets an apology message, or gets someone else's order details."

---

## 9. Appendix — how to reproduce this review

```bash
# Code
npm run build && npm run lint

# Live DB (Neon project winter-flower-03790042, branch production)
#   row counts, tenant config, capabilities, audit trail, duplicate waMessageIds
#   pg_policies / pg_indexes / pg_extension
```

Key DB queries used:

```sql
select count(*) from "Message" where "waMessageId" is not null;         -- 212
select "waMessageId", count(*) from "Message"
  where "waMessageId" is not null group by 1 having count(*) > 1;        -- 11 groups
select action, count(*) from "AuditLog" group by 1 order by 2 desc;
select tablename from pg_policies;                                       -- 19 tables
select indexdef from pg_indexes where tablename='KnowledgeEmbedding';    -- no vector index
```
