# CSQ Agent Runtime — Gap Closure Status

**Date:** 2026-08-21
**Scope:** Status of all 10 gaps identified in the agent-flow audit. All are closed in code and deployed. This report supersedes the original open-gap report (deleted).
**Live commit:** `114521e` (Render service `csq` / `srv-da2benou01pc73b25e90`, Singapore) — live, `/api/health` → 200.
**Related plan:** `.claude/plans/linear-wobbling-stearns.md`

---

## Summary

All 10 gaps closed. **G3 is runtime-verified end-to-end.** G1, G2, G4–G10 are closed in code, build + lint green, the schema migration applied to Neon, and the deploy live and healthy — but **not yet exercised with live WhatsApp traffic** on Render (see "Remaining work" below). Two batches: G3 landed in commit `b9b91d1`; G1/G2/G4–G10 landed in commit `114521e`.

| # | Gap | Severity | Status | Verified |
|---|---|---|---|---|
| G1 | Approval result never sent back to customer | Critical | ✅ Closed | Code-level |
| G2 | Concurrent messages race (no per-conversation lock) | Critical | ✅ Closed | Code-level |
| G3 | Semantic search dead — no embeddings generated | High | ✅ Closed | **Runtime-verified** |
| G4 | Agent memory never injected | High | ✅ Closed | Code-level |
| G5 | Silent failure, no customer fallback when OpenClaw errors | High | ✅ Closed | Code-level |
| G6 | Truncated 6-iteration loop → empty/partial reply | Medium | ✅ Closed | Code-level |
| G7 | No 24h-window check on agent path; no template send | Medium | ✅ Closed | Code-level |
| G8 | Source priority config-only, not consulted by tools | Medium | ✅ Closed | Code-level |
| G9 | `inventory.update`/`order.*` `where` missing `tenantId` | Low | ✅ Closed | Code-level |
| G10 | No continuity beyond 20-message window | Low | ✅ Closed | Code-level |

---

## What was done per gap

### G3 — on-demand pgvector retrieval via Fireworks Qwen3 (commit `b9b91d1`)
- `src/services/embeddings.ts` (new): `embed`/`embedBatch`/`isEmbeddingsConfigured` via Fireworks `/v1/embeddings`, model `fireworks/qwen3-embedding-8b` (serverless, multilingual — Bahasa Indonesia), `dimensions: 1024`.
- Migration `20260820120000_embedding_dim_1024`: `vector(1536)` → `vector(1024)`; fixed `upsertEmbedding` to generate `id` via `gen_random_uuid()::text`.
- `knowledge.search`: removed the dead model-facing `queryEmbedding` param; handler generates the embedding server-side from `query` → `findSimilar` (threshold via `KNOWLEDGE_SIMILARITY_THRESHOLD`, default 0.5), keyword `contains` fallback on failure/empty/no-key.
- `buildSystemPrompt`: stopped loading FAQ/POLICY; BUSINESS_INFO bounded to 10; safety rules require the agent to call `knowledge.search` and never fabricate.
- Knowledge CRUD + seed: best-effort `upsertEmbedding`/`deleteEmbedding`; graceful degradation when no key.
- **Runtime-verified:** seeded 4 embeddings at 1024 dims; semantic query "Kalau barang yang saya beli rusak, bisa ditukar?" returned Kebijakan Retur @ similarity 0.683.

### G1 — approval result sent back to customer (commit `114521e`)
- `ExecuteArgs` (`src/tools/execute.ts`) gains `conversationId`/`channelId`; threaded through `RunConversationArgs` (`src/services/openclaw.ts`) → `executeTool` → the approval_required branch stores them on the `Approval` row.
- New `sendApprovalFollowUp` in `src/lib/agent-outbox.ts`; `approve`/`reject` routes fire-and-forget it, sending a Bahasa Indonesia follow-up + OUTBOUND/AGENT `Message` + audit. Best-effort: legacy approvals without routing or a disconnected channel skip with a warning.

### G2 — concurrent race, advisory lock per turn (commit `114521e`)
- `processInboundWithAgentInner` wrapped in `prisma.$transaction` acquiring `pg_advisory_xact_lock(hashtext(conversationId)::bigint)`, 120s timeout. Transaction-scoped locks are safe with PgBouncer transaction pooling; serializes turns per conversation across all instances.
- `order.create`/`order.cancel`: `SELECT … FOR UPDATE` on Inventory rows inside the existing `$transaction` (defense-in-depth against oversell).
- Tradeoff noted in code: one pooled connection held per active turn — appropriate at UMKM scale; a lock-table is the documented upgrade path if turn latency grows.

### G4 / G10 — agent memory injected (commit `114521e`)
- New `src/tools/memory.ts`: `memory.search` (read, default-allowed) + `memory.create` (write, approval-gated, upsert by `(tenant,agent,key)`).
- `buildSystemPrompt` injects HIGH-importance memories (bounded to 10) as the continuity layer beyond the chat window; `toChatHistory` slice 20 → 30.
- `memoryCreateSchema` + POST create route complete dashboard CRUD.

### G5 — silent failure → customer fallback (commit `114521e`)
- `processInboundWithAgent`'s catch sends a canned Indonesian fallback via `sendAgentMessage` + `conversation.agent_error` audit (guarded so a second failure can't throw out of the catch).

### G6 — truncated loop surfaced safely (commit `114521e`)
- `MAX_TOOL_ITERATIONS` 6 → 10 (`src/services/openclaw.ts`).
- On `turn.truncated`, `processInboundWithAgentInner` sends a clean "Mohon tunggu, saya sedang memproses permintaan Anda dan akan segera membalas." instead of empty/partial content.

### G7 — 24h window + template send (commit `114521e`)
- `sendTemplate` added to the `WhatsAppProvider` interface (`src/types/whatsapp.ts`) + `CloudApiProvider` (`type:"template"`) + `BaileysProvider` (delegates to `sendText`, no 24h restriction).
- New shared `src/lib/agent-outbox.ts` `sendAgentMessage` with a 24h-window guard: free-form within the window, template outside if configured, else skip+audit (Meta-compliant, not a shortcut). Normal agent reply path refactored through it.
- Env: `WHATSAPP_APPROVAL_TEMPLATE`, `WHATSAPP_AGENT_FALLBACK_TEMPLATE`, `WHATSAPP_TEMPLATE_LANG` (optional, currently unset).

### G8 — source priority consulted (commit `114521e`)
- New `src/lib/source-priority.ts` (`readSourcePriority`, `resolveInventory`, `resolveInventoryBySnapshots`) — single source of truth; the dashboard priority route imports from it.
- New `InventorySnapshot` table (per `tenant,product,source`) via migration `20260821060000_gap_batch`.
- `inventory.read` resolves by `Tenant.settings.sourcePriority`; `applyImport` writes per-source snapshots + recomputes the canonical `Inventory` row by priority (lower-priority imports no longer overwrite a higher-priority source); `inventory.update` writes a MANUAL snapshot.

### G9 — tenant_id on mutation where clauses (commit `114521e`)
- Inventory updates/upserts → compound `tenantId_productId`; Product.update and Order.update → `updateMany` with `{id, tenantId}` + count assert. `import-apply` mutations tenant-gated too.

---

## Verification status

| Level | Result |
|---|---|
| `npm run build` | 0 errors |
| `npm run lint` | 0 warnings/errors |
| Migration applied to Neon | `20260821060000_gap_batch` + `20260820120000_embedding_dim_1024` applied and verified (Approval cols, Memory unique index, InventorySnapshot table, `vector(1024)`) |
| Render deploy | `dep-da3l8qjncjis738ijrf0` → live; `/api/health` → 200 |
| Runtime end-to-end | G3 only (semantic smoke test). G1/G2/G4–G10 not yet exercised with live traffic. |

---

## Remaining work (live behavior verification, not implementation)

The implementation is complete. What remains is **runtime verification on the live app**, which requires a connected WhatsApp channel with real credentials (the seeded demo channel is `DISCONNECTED` with `DEMO_*` creds) and, for the outside-24h cases, a Meta-approved template.

To runtime-verify end-to-end:
1. Connect a real channel (Cloud API test number or Baileys QR).
2. Optionally approve 1–2 templates in Meta Business Manager; set `WHATSAPP_APPROVAL_TEMPLATE` / `WHATSAPP_AGENT_FALLBACK_TEMPLATE` in the Render env. Until then, outside-24h sends are skipped+audited (correct), inside-24h sends work normally.
3. Run the PRD §21 demo scenario: customer asks to change a price → agent refuses + queues approval → owner approves in the dashboard → confirm the customer receives the follow-up (G1), the reply is within the 24h window (G7), stock/permission behavior holds (G2/G9), and a knowledge/policy question retrieves via `knowledge.search` (G3).
4. For G2 concurrency: send two rapid messages on one conversation; confirm one serialized reply pair, no duplicate.
5. For G5/G6: temporarily break `OPENCLAW_BASE_URL` / force a long tool chain; confirm fallback + "Mohon tunggu…" messages.
6. For G8: import the same product via EXCEL then GOOGLE_SHEETS with `sourcePriority=["MANUAL","GOOGLE_SHEETS","EXCEL"]`; confirm `inventory.read` returns the higher-priority quantity.

---

## Key files

**Created:** `src/services/embeddings.ts`; `src/lib/agent-outbox.ts`; `src/lib/source-priority.ts`; `src/tools/memory.ts`; migrations `20260820120000_embedding_dim_1024`, `20260821060000_gap_batch`.

**Modified:** `src/tools/{execute,order,inventory,product,knowledge,index}.ts`; `src/services/{openclaw,whatsapp,baileys}.ts`; `src/lib/{agent-loop,prompt-builder,inbox,import-apply,vector}.ts`; `src/types/{whatsapp,memory}.ts`; `src/pages/api/dashboard/{approvals,memory,sources}/*`; `prisma/schema.prisma`; `.env.example`; `.env.production.example`.

**Deleted:** `docs/report/agent-flow-gap-report.md` (the original open-gap report — superseded by this file).
