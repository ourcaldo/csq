# 33. LLM Usage and Cost Tracking (owner request 2026-11-27)

Status: **draft** - awaiting owner approval. Not implemented.

## Problem

The platform pays the LLM provider for every AI reply, but records nothing
about that spend. The credit ledger (`AiCreditUsage`, PRD 14) counts events
(1 credit per reply, 1 per scenario module) and is the tenant-facing quota
meter - it holds no tokens, no model, no money. The chat response boundary
(`chatCompletionResponseSchema`) does not even parse the provider's `usage`
object, so prompt/completion token counts are discarded on arrival. The
operator therefore cannot answer: what does an AI reply actually cost, per
tenant, per model, per month - and how does that compare to the plan price
the tenant pays. This PRD closes that gap for the LLM dimension only.

## Scope: where LLM spend happens today

All LLM calls are OpenAI-compatible against `LLM_BASE_URL` with
`LLM_API_KEY`. Call sites (both `apps/api` and `apps/worker` run turns;
`apps/dashboard` runs BFF-side knowledge embeddings and scenario drafting):

| # | Call site | Model env | Runs in | Billed unit |
|---|---|---|---|---|
| 1 | `packages/core/src/services/llm-runtime.ts` chatCompletion loop (agent turns) | `LLM_CHAT_MODEL` | api + worker | prompt + completion tokens |
| 2 | `packages/core/src/services/llm.ts` generateText (scenario AI nodes, BFF drafting) | `LLM_SCENARIO_MODEL` or `LLM_CHAT_MODEL` | api + worker + dashboard | prompt + completion tokens |
| 3 | `packages/core/src/services/embeddings.ts` embed/embedBatch (knowledge write + knowledge.search query) | `LLM_EMBEDDING_MODEL` | api + worker + dashboard | prompt tokens |
| 4 | `packages/core/src/lib/guardrail.ts` decide (Google Decisions API, `gemini-decision-1`) | n/a (Decisions API) | api + worker | per request, no token usage in response |

In scope: 1, 2, 3. Out of scope: 4 (the Decisions API response carries only
calibrated scores, no token usage, so there is nothing token-priced to
record; if its provider bill becomes material, it gets its own dated
amendment - verify live provider docs first, repo rule).

## Non-goals (do not build)

- No change to the credit system: credits stay the tenant-facing meter and
  the quota gate (PRD 14 is untouched). Tenants see no new numbers.
- No automatic billing: invoice amounts stay operator-set (PRD 14 manual
  model). This feature gives the operator the cost data to price plans and
  invoices; it never writes an invoice.
- No WhatsApp/Meta conversation-cost tracking (channel spend is a separate
  platform's billing; its own PRD if ever requested).
- No per-message UI drill-down in v1, no tenant-facing cost pages, no
  budget alerts, no per-call latency dashboards.

## Data model

Two tables, one platform one tenant-scoped.

### `LlmUsage` (tenant-scoped)

One row per successful LLM call (the provider answered and was parsed).
Written AFTER the response, fail-soft: a write error is logged and never
breaks the turn - same posture as the credit charge failure path.

```
model LlmUsage {
  id               String   @id @default(uuid())
  tenantId         String
  source           LlmUsageSource
  refId            String?    // turn ref (trigger Message id) or ScenarioRunStep id
  conversationId   String?    // only for agent-turn calls
  model            String     // actual model string from the request
  promptTokens     Int?       // null when the provider omits usage
  completionTokens Int?
  costIdr          Decimal?   @db.Decimal(16, 4)  // snapshot, null = unpriced
  createdAt        DateTime  @default(now())

  tenant Tenant @relation(..., onDelete: Cascade)

  @@index([tenantId, createdAt])
  @@index([createdAt])
  @@index([tenantId, source, refId])
}
```

- `source`: enum `AGENT_CALL` (agent-turn chat completions, one row per
  loop iteration - a 5-tool-call turn writes up to 6 rows), `SCENARIO_AI`
  (generateText), `EMBEDDING` (embed/embedBatch).
- `refId` ties rows to the same ref the credit ledger uses:
  - `AGENT_CALL`: the turn ref = trigger inbound `Message.id` (or a
    pre-generated UUID when absent). Today `chargeRef` is computed AFTER
    the turn in `runAgentReply`; it must move to the TOP of the turn and
    be threaded into `runConversation` so both `LlmUsage` rows and the
    `AiCreditUsage` charge share one ref. A guard-enforce retry reuses the
    same ref, so the whole turn (original + retry) sums into one reply.
  - `SCENARIO_AI`: the `ScenarioRunStep.id` (scenario engine path); null
    for BFF-side drafting.
  - `EMBEDDING`: the `Knowledge.id` when the caller has it; null for
    knowledge.search query embeddings.
- No uniqueness constraint: each row is a distinct real call, and a lost
  row is acceptable telemetry loss (unlike the credit ledger, which is
  billing truth). Writes are plain `create`, safe from both api and worker
  processes.

### `LlmModelPrice` (platform, no tenantId)

Operator-configured price per model. Prices are NEVER seeded or hardcoded
in code: the repo rule about live platform pricing applies, and the
operator enters current provider prices (which they must verify against the
provider's official pricing themselves).

```
model LlmModelPrice {
  id              String   @id @default(uuid())
  model           String   @unique
  inputIdrPer1M   Decimal  @db.Decimal(14, 2)   // per 1M prompt tokens
  outputIdrPer1M  Decimal  @db.Decimal(14, 2)   // per 1M completion tokens (0 for embedding models)
  updatedById     String
  updatedAt       DateTime @updatedAt
}
```

### Cost computation (at write time, snapshot)

`costIdr = promptTokens * inputIdrPer1M / 1_000_000 +
completionTokens * outputIdrPer1M / 1_000_000`, rounded to 4 decimals,
computed when the row is written using the CURRENT price row. Consequences,
accepted deliberately (same posture as invoice plan snapshots):

- A later price edit changes only future rows; history is never rewritten.
- A mis-keyed price is fixed forward; the operator can void-and-reissue any
  affected manual invoice - there is no automatic reconciliation.
- No price row for a model: `costIdr` is null and the row still records
  tokens. The admin page surfaces "unpriced calls" so the gap is visible,
  never silent.

Prices are entered in IDR per 1M tokens directly (not USD + FX rate): the
operator's provider bills or reseller quotes are the source of truth, and
avoiding an FX-rate config keeps one variable out.

## Capture points (implementation map)

1. `chatCompletionResponseSchema` gains an optional `usage` object
   (`prompt_tokens`, `completion_tokens`, `total_tokens` - all optional:
   compat layers may omit it; a missing usage still parses and writes a row
   with null tokens and null cost).
2. `llm-runtime.ts`: after each successful `chatCompletionOnce`, write the
   `AGENT_CALL` row (tenant, turn ref, conversationId, model, tokens,
   computed cost). Try/catch, warn on failure.
3. `agent-loop.ts`: hoist the turn ref to the top of `runAgentReply`, pass
   it into `runConversation` (new arg) and reuse it for the existing
   `chargeCredits` call.
4. `llm.ts` `generateText`: parse usage (`.passthrough()` already keeps
   it), write `SCENARIO_AI` row; caller passes tenantId + step ref where
   available (scenario engine has both; BFF drafting passes tenantId).
5. `embeddings.ts`: parse usage from the embeddings response, write
   `EMBEDDING` row when the caller supplies a tenantId (knowledge write,
   knowledge.search); calls without a tenant context are skipped.
6. Shared core helper `recordLlmUsage` in `packages/core/src/lib/llm-usage.ts`
   (price lookup + insert + warn-on-fail), used by all five sites. No
   changes to any dashboard/tenant surface.

## Admin console surfaces (English UI, PRD 13 amendment 2026-11-13)

### New page `/admin/llm-usage` (nav "LLM Usage", group Monetization & Quotas)

1. **Month selector** - default current month; options back to the first
   recorded month.
2. **Stat strip**: total LLM cost (IDR) for the month, calls, prompt
   tokens, completion tokens, unpriced calls, and **cost per AI reply**
   (sum of `AGENT_CALL` cost / count of `AiCreditUsage` REPLY rows - both
   sides keyed by the same turn ref, so retries and unsent replies land
   on both sides equally).
3. **Daily cost chart** for the selected month.
4. **Model breakdown table**: model, calls, tokens in/out, cost, share %;
   inline price editor per model (input/output IDR per 1M) and an
   "unpriced" badge when a model has calls but no price row. Price edits
   write `AdminActionLog`.
5. **Per-tenant table**: tenant, plan, AI replies (ledger), LLM cost,
   cost per reply, plan price, and cost as a % of plan price. Sortable by
   cost. A cost % above 100 is the operator's margin-loss flag - the page
   only surfaces it, it does not act.

### `/admin/plans` (existing usage table)

One added column: LLM cost (current month, IDR), linking to
`/admin/llm-usage`. `/api/admin/usage` gains the per-tenant LLM aggregate.

### API

- `GET /api/admin/llm-usage?month=YYYY-MM` - all aggregates above.
- `POST /api/admin/llm-usage/prices` (create/update one model price) -
  `requireAdmin` + `AdminActionLog`, matching existing admin route
  conventions. Decimal values cross the boundary as strings and are
  Zod-parsed.

No tenant-facing page or endpoint changes.

## Security and audit

- `LlmUsage` and prices are operator-only. No tenant API exposes them; no
  tenant role can read cost data (it is the operator's margin information).
- Price edits are audited (`AdminActionLog` actor + before/after).
- Usage rows carry no message content, no prompts, no secrets - only
  counts, model names, and refs.
- All queries are platform-scoped inside `withSystemContext` in admin
  routes, matching every existing admin endpoint.

## Migration and backfill

- Migration creates the two tables and the enum. No backfill: token usage
  was never captured, so history starts at deploy. The credit ledger's
  history is untouched and still correct for quotas.
- Worker's `migrate deploy` must skip the manual clone application, per the
  standing migration ritual for this repo.

## Scaling

One row per LLM call. Worst case today: a tool-heavy turn writes ~6 rows,
plus ~2 embedding rows. At 100k AI replies/month that is under 1M
rows/month, roughly 150 MB/month with indexes - monthly `groupBy` over
`@@index([tenantId, createdAt])` and `@@index([createdAt])` stays cheap.
No rollup table in v1; if raw rows pass ~10M, add a monthly rollup then,
not now (tracked in `docs/report/` if it ever approaches that). Rows are
never deleted in v1: they are the cost paper trail behind manual invoices.

## Acceptance criteria

- Every successful chat completion, generateText, and embedding call
  writes exactly one `LlmUsage` row; a turn with 3 loop iterations writes
  3 `AGENT_CALL` rows sharing one refId.
- A provider response without `usage` still yields a row with null tokens
  and null cost, and the turn succeeds.
- A failed LLM write never fails or delays the customer reply (verified by
  forcing the insert to throw in a self-check).
- Credit charge ref and `AGENT_CALL` ref are identical for the same turn.
- With a price row set: `costIdr` matches the formula to 4 decimals; with
  no price row: null cost, and the admin page shows the unpriced count.
- `/admin/llm-usage` shows stat strip, daily chart, model breakdown with
  working price editor, and per-tenant cost table; `/admin/plans` shows
  the LLM cost column.
- A tenant user (any role, any token) cannot reach any new endpoint or see
  any cost number.
- Price edit writes an `AdminActionLog` row.

## Open decisions (owner)

1. **Cost basis** - recommended: operator-configured IDR per 1M tokens
   (this PRD as written). Alternative: record provider USD + an FX-rate
   setting. IDR-direct avoids FX config but assumes the operator's
   provider quotes in IDR or converts once when entering prices.
2. **Page shape** - recommended: new `/admin/llm-usage` page plus one
   column on Plans & Usage. Alternative: everything crammed into
   `/admin/plans` (fewer routes, but the price editor + model breakdown
   make that page unwieldy).
3. **Guard calls** - excluded from v1 (no token data in the Decisions API
   response). Confirm or override.
4. **Tenant visibility** - tenants see nothing new (credits remain their
   meter). Confirm or override.
