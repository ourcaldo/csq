# CSQ Agent Runtime — Gap Report

**Date:** 2026-08-20
**Scope:** Gaps between the implemented agent runtime flow and the PRD / master plan.
**Method:** Full trace of the WhatsApp → OpenClaw → WhatsApp flow against `docs/prd-product-requirements-document.md`, `plans/00-master-plan.md`, and `AGENTS.md`. Every gap is verified against code with file:line evidence.

---

## Baseline flow (as implemented today)

```
Customer WhatsApp
   │  (inbound)
   ▼
Webhook (Cloud API) or Baileys socket  →  ingestInboundMessage()  →  Message row saved
   │
   ▼  (fire-and-forget, void — not awaited)
processInboundWithAgent()  →  runAgentReply()  →  runConversation()  ──┐
                                                                        │
        ┌───────────────────────────────────────────────────────────────┘
        ▼
   POST {cell.baseUrl}/v1/chat/completions   ←  messages=[system+history+user], tools=[…], model=openclaw/<agentId>
        │
        ▼  loops up to 6×
   OpenClaw returns assistant text OR tool_calls
        │
        ├── tool_calls?  → executeTool() in-process → permission check → audit → role:"tool" result pushed back → loop
        │
        └── finish_reason=stop?  → reply string
        ▼
   provider.sendText()  →  WhatsApp Cloud API / Baileys  →  outbound Message row saved + audit log
```

**Key files:** `src/pages/api/webhooks/whatsapp.ts`, `src/services/baileys.ts`, `src/lib/inbox.ts`, `src/lib/agent-loop.ts`, `src/lib/prompt-builder.ts`, `src/services/openclaw.ts`, `src/services/openclaw-cell.ts`, `src/tools/execute.ts`, `src/lib/permissions.ts`, `src/lib/audit.ts`, `src/tools/knowledge.ts`, `src/lib/vector.ts`, `src/tools/index.ts`.

---

## 🔴 Critical (will visibly break on stage)

### G1 — Approval result is never sent back to the customer

The agent says "I'll confirm with the owner," the owner clicks Approve, `executeApprovedAction` runs and marks the Approval `APPROVED` — but **no reply ever goes back to the customer**.

- **Evidence:** `src/pages/api/dashboard/approvals/[id]/approve.ts:34-44` only returns JSON to the dashboard; no `provider.sendText`, no `Message.create`, no re-entry into the conversation. `src/tools/execute.ts:157-230` has no conversation/channel context.
- **Root cause:** the `Approval` row carries `agentId` but **no `conversationId`/`customerPhone`** — there's nothing to route a reply with.
- **PRD/plan trace:** PRD §14 (Escalation), §16 (Approval System), §27 (Act by policy → verify → record). A PRD headline feature.
- **Fix direction:** Add `conversationId`/`customerPhone` to `Approval`; after `executeApprovedAction` succeeds, send a templated follow-up via the channel provider and record an AGENT outbound `Message` + audit. Depends on G7 (24h/template) for the Cloud API case.

### G2 — Concurrent messages race on the same conversation (no lock/serialization)

`processInboundWithAgent` is fire-and-forget per message (`whatsapp.ts:161`, `baileys.ts:233`). No per-conversation lock, queue, or `SELECT ... FOR UPDATE`. Two quick messages → two parallel `runAgentReply` runs → duplicate replies, and worse, **double order creation / double stock decrement**.

- **Evidence:** No `advisory_lock`/`FOR UPDATE`/per-conversation mutex anywhere. `src/lib/agent-loop.ts:93-97` reads history non-atomically. `src/tools/order.ts:133-150` validates `have < item.quantity` inside a tx, but two parallel txs both read `have=12`, both decrement to 10 → actual 8; no row-level lock on the inventory read.
- **PRD/plan trace:** PRD §11 (writes must record correct before/after), §22 ("100% of successful write operations logged" + correct stock math). Phase 5/7.
- **Fix direction:** `pg_advisory_xact_lock(hashtext(conversationId))` around the whole turn, or an in-process per-conversation async queue. Also `FOR UPDATE` on inventory rows inside the `order.create` transaction.

---

## 🟠 High (a judge comparing PRD/SDD vs running system will catch these)

### G3 — Semantic knowledge search is completely dead (no embeddings ever generated)

`knowledge.search` only runs the pgvector path when `queryEmbedding` is supplied, but `runConversation` never generates one. `upsertEmbedding`/`deleteEmbedding` (`src/lib/vector.ts:33,69`) have **zero callers** in `src/`. `KnowledgeEmbedding` rows are never created → `findSimilar` always returns `[]` → every query falls back to Prisma keyword `contains` (`src/tools/knowledge.ts:57-68`). The headline "no separate vector DB" pgvector architecture (PRD §23A) is inert at runtime.

- **Evidence:** `src/lib/vector.ts:33` (defined, no callers); `src/tools/knowledge.ts:7-9` comment "Phase 6 will generate one from the agent runtime" — never done. No `text-embedding-3-small` call anywhere in `src/`.
- **PRD/plan trace:** PRD §23A, §23B.4/§23B.6, Phase 1 open risk row ("Embedding model choice … Unresolved").
- **Fix direction:** Generate embeddings on Knowledge write (`knowledge/create.ts`, `knowledge/[id].ts` update/delete) via OpenAI `text-embedding-3-small` → `upsertEmbedding`; generate a query embedding inside `knowledge.search`'s handler (or `runConversation`) before calling `findSimilar`.

### G4 — Agent memory is never injected into the agent (model + dashboard CRUD only)

The `Memory` model exists (`prisma/schema.prisma:328-342`) with dashboard CRUD (`src/pages/api/dashboard/memory/*`), but **no memory tool is registered** (`src/tools/index.ts:48-54` lists product/inventory/order/customer/knowledge only) and `buildSystemPrompt` (`src/lib/prompt-builder.ts:13-79`) never queries `prisma.memory`. The agent cannot read or write memories at runtime. `Memory.source = CONVERSATION` has no code path that ever creates one.

- **Evidence:** No `memory.search`/`memoryTools` in `src/lib` or `src/tools`. `prompt-builder.ts:17-30` loads only FAQs/policies/businessInfo.
- **PRD/plan trace:** PRD §7.3 (Memory is part of business context), §15.5 (Memory dashboard), §29 ("Agent memory" in final definition). SRS FR-KN / Phase 3.
- **Fix direction:** Add a `memory.search` read tool (default-allowed) backed by `prisma.memory.findMany({ where: { tenantId, agentId } })`; inject high-importance memories into `buildSystemPrompt`. Optionally a `memory.create` write tool gated by approval.

### G5 — Silent failure with no customer fallback when OpenClaw is down or errors

`processInboundWithAgent` (`src/lib/agent-loop.ts:136-150`) catches all errors and `console.error`s them. The customer receives **nothing** — no "maaf, sistem sedang gangguan" fallback, no escalation to a human, no `PENDING` status. `runConversation` throws on non-2xx (`openclaw.ts:86`) and on fetch network errors; those bubble up and are swallowed.

- **Evidence:** `agent-loop.ts:142-149` (catch → console.error only); no `Message.create` for a failure reply, no conversation status change.
- **PRD/plan trace:** PRD §14 (Escalation when agent lacks info / unknown-high-risk), §18 (reliability). Phase 7.
- **Fix direction:** In the catch, send a canned Indonesian fallback reply via the provider (the 24h window is open because the inbound just arrived) and/or flip the conversation to `PENDING` + assign to a human per the escalation policy.

---

## 🟡 Medium

### G6 — Truncated tool loop (MAX_TOOL_ITERATIONS=6) not safely surfaced to the customer

When the 6-iteration cap is hit (`src/services/openclaw.ts:142,182-190`), `runConversation` returns `truncated: true` and the last assistant content — which may be **empty** if the last message was a bare tool_call. That string becomes the reply (`agent-loop.ts:128-133`); an empty reply is silently dropped (`if (turn.stoodDown || !turn.reply.trim()) return`), so the customer gets nothing with no indication the agent hit a cap. The `truncated` flag is only audited (`agent-loop.ts:222`), never shown.

- **Evidence:** `openclaw.ts:183-190` returns `lastAssistant?.content ?? ""`; `agent-loop.ts:168` drops empty replies.
- **PRD/plan trace:** PRD §14 escalation, §24 (Reason → Check Permission → Act → Verify → Record).
- **Fix direction:** When `truncated && !reply.trim()`, substitute a safe Indonesian "Mohon tunggu, saya sedang memproses" or escalate; consider raising the cap to 8-10 for the order workflow.

### G7 — No 24h-window guard on the agent path, and no template messaging anywhere

`sendHumanReply` (`src/lib/inbox.ts:198-213`) enforces the 24h Cloud API window for **human** replies. The **agent** path (`agent-loop.ts:177-191`) has only a comment asserting "this auto-reply is always in direct response to a fresh inbound, so the window is open" — it never checks. If an inbound is delayed (Meta retry, Baileys queue) the reply could be >24h after the actual message. More importantly, **no `type:"template"` send path exists anywhere** (`src/services/whatsapp.ts:64-65` comment: "templates for proactive outbound are a later concern"), so the entire "proactive outbound outside 24h requires templates" requirement is unimplemented — which also **blocks G1's approval follow-up reply**.

- **Evidence:** No `type: "template"` request built anywhere in `src/`; `agent-loop.ts:179` comment-only assertion.
- **PRD/plan trace:** PRD §4.4 (Cloud API: free-form within 24h, templates for proactive), §23A. Phase 7.
- **Fix direction:** Add `sendTemplate` to `CloudApiProvider`; add a window check in `agent-loop.ts` that falls back to a template when `lastInbound` is >24h old.

### G8 — Source priority (MANUAL/EXCEL/GOOGLE_SHEETS) is config-only, never consulted by the tools

`Tenant.settings.sourcePriority` is stored and editable (`src/pages/api/dashboard/sources/priority.ts`, seeded in `seed.ts:19` / `register.ts:50`). But the data model keeps **one** `Inventory` row per product (`productId @unique`, `schema.prisma:249`) and **one** `Product` row. `inventory.read` (`src/tools/inventory.ts:43-54`) just returns that single row — no multi-source merge, no "find the record from the highest-priority source," no conflict escalation. `InventorySource`/`DataSource` are stored metadata, not a resolution layer.

- **Evidence:** `src/tools/inventory.ts:43` `findFirst({ where: { tenantId, productId } })` — no `sourcePriority` read. No `sourcePriority` reference in `src/tools` or `src/lib`. SDD `docs/sdd-system-design-document.md:1632` specifies the resolution algorithm that was never implemented.
- **PRD/plan trace:** PRD §13 (Data Authority and Conflict Handling), SRS FR-CA-001/002/003. Phase 4/5.
- **Fix direction:** Model per-source inventory snapshots and resolve by `Tenant.settings.sourcePriority` in `inventory.read`, or explicitly document last-write-wins and drop the conflict test from the demo.

---

## 🟢 Low

### G9 — Tenant-isolation gap in write-path `where` clauses

The `before` read is tenant-scoped, but `prisma.inventory.update({ where: { productId } })` (`src/tools/inventory.ts:79`, `src/tools/order.ts:168,241`) keys only on `productId` (a `@unique` field), **not** on `tenantId`. AGENTS.md says "Every database query filters by `tenant_id` — no exceptions." RLS is `ENABLED` but not `FORCED` and the owner role bypasses it (`20260818010000_rls_policies:8-17`), so app-level filtering is the live guard — and it's missing on the mutation.

- **Evidence:** `src/tools/inventory.ts:79-81`; `src/tools/order.ts:168-170,241-243`.
- **PRD/plan trace:** AGENTS.md "Security — Non-Negotiable", PRD §18.1.
- **Fix direction:** Use the compound unique `where: { tenantId_productId: { tenantId, productId } }`, or `updateMany` with a `tenantId` filter.

### G10 — No continuity beyond a 20-message window; OpenClaw session memory unvalidated

`runAgentReply` loads the last 30 messages (`agent-loop.ts:93-97`) and `toChatHistory` slices to the last **20** (`prompt-builder.ts:87-88`). Anything older is lost from the agent's view. The OpenClaw `user: conversationId` field (`openclaw.ts:71`) is sent as a session key, but CSQ does not rely on (or verify) any server-side OpenClaw memory — it always re-sends the windowed history. Whether OpenClaw actually persists cross-turn memory is unvalidated (master-plan open risk).

- **Evidence:** `agent-loop.ts:93` `take: 30`; `prompt-builder.ts:88` `limit = 20`.
- **PRD/plan trace:** PRD §4.3 (OpenClaw: Sessions), §26. Phase 6 open risk.
- **Fix direction:** Combine with G4 — persist important facts into `Memory` and inject them so context survives beyond the window; validate whether OpenClaw's `user` session key gives server-side continuity and, if so, stop re-sending duplicate history.

---

## ✅ Confirmed NOT gaps (so these don't get re-litigated)

- **Demo safety moment (unauthorized price change):** Structurally enforced, not prompt-only. `product.update` defaults to `{ allowed: false, requiresApproval: true }` (`src/tools/product.ts:116`), so `checkPermission` (`src/lib/permissions.ts:18-25`) blocks it even under prompt injection, and the denied attempt is audited (`src/tools/execute.ts:52-61`). The system prompt (`prompt-builder.ts:66-76`) only makes the refusal natural. Correct defense-in-depth per PRD §18.1.
- **Zod at external boundaries:** OpenClaw response parsed via `chatCompletionResponseSchema.parse` (`openclaw.ts:89`); Cloud API webhook via `webhookPayloadSchema` (`whatsapp.ts:8` via `parseCloudApiInbound`); Baileys boom via `boomSchema` (`baileys.ts:58`); send result via `sendTextResponseSchema` (`whatsapp.ts:89`).
- **Webhook HMAC** verified fail-closed (`whatsapp.ts:130-143`).
- **Audit log completeness for the in-process loop:** Every `executeTool` path writes an audit row — denied (`execute.ts:52`), approval-pending (`execute.ts:93`), ok via the handler's `ctx.audit` closure (`execute.ts:113-124`). Agent reply audited with tool-call count + truncated flag (`agent-loop.ts:210-224`). Complete.
- **`CREATE EXTENSION vector`** present at `prisma/migrations/20260817113947_init/migration.sql:2`; column `vector(1536)`.
- **Tenant isolation in read tools:** All read handlers filter by `ctx.tenantId` (`product.ts:53,82`, `inventory.ts:43`, `order.ts:72`, `customer.ts:38`, `knowledge.ts:48,58`). Clean — gap is only on mutation where-clauses (G9).

---

## Summary table

| # | Gap | Severity | One-line fix |
|---|---|---|---|
| G1 | Approval result never sent back to customer | Critical | Add `conversationId`/`customerPhone` to `Approval`; after `executeApprovedAction`, send reply via provider + record Message |
| G2 | Concurrent messages race (no per-conversation lock) | Critical | `pg_advisory_xact_lock` or in-process queue per conversationId; `FOR UPDATE` on inventory in order tx |
| G3 | Semantic search dead — no embeddings generated | High | Call `upsertEmbedding` on Knowledge write; generate query embedding in `knowledge.search`/loop |
| G4 | Agent memory never injected (no memory tool, not in prompt) | High | Add `memory.search` tool + inject high-importance memories into `buildSystemPrompt` |
| G5 | Silent failure, no customer fallback when OpenClaw errors | High | In catch, send canned fallback reply / set conversation PENDING + assign human |
| G6 | Truncated 6-iteration loop → empty/partial reply to customer | Medium | Substitute safe message when `truncated && !reply.trim()`; raise cap |
| G7 | No 24h-window check on agent path; no template send | Medium | Add `sendTemplate` to CloudApiProvider + window check in agent-loop |
| G8 | Source priority config-only, not consulted by tools | Medium | Resolve multi-source inventory by `Tenant.settings.sourcePriority` in `inventory.read` |
| G9 | `inventory.update`/`order.*` `where` missing `tenantId` | Low | Use compound `tenantId_productId` unique in update where-clauses |
| G10 | No continuity beyond 20-message window; OpenClaw session memory unvalidated | Low | Persist facts to Memory (G4); validate OpenClaw `user` session continuity |

---

**Bottom line:** G1 and G2 are the demo-killers. G3 and G4 are the "architecture claims X but X is inert" gaps a judge will spot from the SDD. Everything else is real but survivable on stage.
