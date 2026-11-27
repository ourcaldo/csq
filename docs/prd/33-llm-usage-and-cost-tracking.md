# 33. LLM Usage and Cost Tracking (owner request 2026-11-27)

Status: **approved** (owner decisions 2026-11-27, below). Not yet implemented.

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

In scope: 1, 2, 3, and 4 (owner decision 2026-11-27: guard calls are
included). For the guard, the Decisions API response carries only
calibrated scores and MAY carry no token usage - the implementation must
parse its live response shape against the official docs, never from
memory. If the response exposes usage, guard rows are priced like chat
calls; if it does not, they are recorded as call-count rows with null
tokens and null cost, shown as unpriced in the admin page - visible, not
silent.

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
  conversationId   String?    // only for agent-turn and guard calls
  model            String     // actual model string from the request
  promptTokens     Int?       // null when the provider omits usage
  completionTokens Int?
  costUsd          Decimal?   @db.Decimal(16, 8)  // provider cost snapshot, null = unpriced
  fxRateIdrPerUsd  Decimal?   @db.Decimal(12, 2)  // FX rate snapshot used for costIdr
  costIdr          Decimal?   @db.Decimal(16, 4)  // = costUsd * fxRate, null when either input is missing
  createdAt        DateTime  @default(now())

  tenant Tenant @relation(..., onDelete: Cascade)

  @@index([tenantId, createdAt])
  @@index([createdAt])
  @@index([tenantId, source, refId])
}
```

- `source`: enum `AGENT_CALL` (agent-turn chat completions, one row per
  loop iteration - a 5-tool-call turn writes up to 6 rows), `SCENARIO_AI`
  (generateText), `EMBEDDING` (embed/embedBatch), `GUARD` (Decisions API
  pre- and post-turn checks; one row per decide() call - an
  enforce-mode retry turn writes up to 3: 1 pre + 2 post).
- `refId` ties rows to the same ref the credit ledger uses:
  - `AGENT_CALL` and `GUARD`: the turn ref = trigger inbound `Message.id`
    (or a pre-generated UUID when absent). Today `chargeRef` is computed
    AFTER the turn in `runAgentReply`; it must move to the TOP of the turn
    and be threaded into `runConversation` AND both guard entry points
    (`checkInboundMessage`, `checkAgentReply`) so `LlmUsage` rows and the
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

Operator-configured price per model in **USD per 1M tokens** (owner
decision 2026-11-27: provider prices are USD; IDR is derived daily).
Prices are NEVER seeded or hardcoded in code: the repo rule about live
platform pricing applies, and the operator enters current provider prices
(which they must verify against the provider's official pricing
themselves).

```
model LlmModelPrice {
  id              String   @id @default(uuid())
  model           String   @unique
  inputUsdPer1M   Decimal  @db.Decimal(14, 6)   // per 1M prompt tokens
  outputUsdPer1M  Decimal  @db.Decimal(14, 6)   // per 1M completion tokens (0 for embedding models)
  updatedById     String
  updatedAt       DateTime @updatedAt
}
```

### `FxRate` (platform, no tenantId) - daily USD to IDR

Owner decision 2026-11-27: the IDR value of a call is computed with the
conversion rate OF THAT DAY, and the rate is stored so historical cost
never drifts when the currency moves.

```
model FxRate {
  date        DateTime @unique   // UTC calendar day, midnight
  usdIdr      Decimal @db.Decimal(12, 2)
  source      FxRateSource       // AUTO | MANUAL
  updatedById String?            // set on MANUAL edits
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

- **AUTO**: the worker's existing daily tick fetches the day's USD/IDR
  rate once per day from a public FX endpoint. The concrete endpoint is
  chosen and verified against its live docs at implementation time - repo
  rule, no quoting API terms from memory. A fetch failure is fail-soft:
  reuse the most recent existing rate for that day's rows and log it.
- **MANUAL**: the operator can add or correct any day's rate from the LLM
  Usage page (audited). Manual edits change only FUTURE usage rows - rows
  already written keep their `fxRateIdrPerUsd` snapshot.
- Usage rows snapshot the rate at write time (`fxRateIdrPerUsd` on
  `LlmUsage`), so the `FxRate` table being edited later never rewrites
  recorded cost. If NO rate row exists at all yet, `costIdr` is null and
  the admin page flags "no FX rate" - visible, not silent.

### Cost computation (at write time, snapshot)

Two steps, both at row-write time:

1. `costUsd = promptTokens * inputUsdPer1M / 1_000_000 +
   completionTokens * outputUsdPer1M / 1_000_000`, rounded to 8 decimals,
   using the CURRENT price row. No price row for the model: `costUsd`
   null (tokens still recorded).
2. `costIdr = costUsd * fxRateIdrPerUsd` (that day's rate, snapshot onto
   the row), rounded to 4 decimals. No rate available: `costIdr` null.

Consequences, accepted deliberately (same posture as invoice plan
snapshots):

- A later price or rate edit changes only future rows; history is never
  rewritten. The snapshot columns (`costUsd`, `fxRateIdrPerUsd`,
  `costIdr`) are the recorded truth for old data - this is exactly why
  the rate is stored per row and per day, not recomputed at read time
  (owner decision 2026-11-27).
- A mis-keyed price or rate is fixed forward; the operator can
  void-and-reissue any affected manual invoice - there is no automatic
  reconciliation.
- The admin page shows BOTH USD and IDR figures, plus the rate in effect,
  and flags unpriced calls and missing-FX calls so gaps are visible,
  never silent.

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
6. `guardrail.ts` `decide()`: after a successful Decisions API response,
   write a `GUARD` row (tenant, turn ref, conversationId,
   model `gemini-decision-1`, tokens from the response when it has usage,
   else null). The pre- and post-turn call sites in `agent-loop.ts` gain
   tenantId + refId + conversationId args. If `GUARD_MODE=off`, no rows.
   The response schema tolerates an optional usage object - verify the
   real shape against live docs during implementation.
7. Worker daily tick: upsert today's `FxRate` row (AUTO), fail-soft.
8. Shared core helper `recordLlmUsage` in `packages/core/src/lib/llm-usage.ts`
   (price lookup + latest FxRate lookup + insert + warn-on-fail), used by
   all call sites. No changes to any dashboard/tenant surface.

## Admin console surfaces (English UI, PRD 13 amendment 2026-11-13)

### New page `/admin/llm-usage` (nav "LLM Usage", group Monetization & Quotas)

1. **Month selector** - default current month; options back to the first
   recorded month.
2. **Stat strip**: total LLM cost (USD and IDR) for the month, calls,
   prompt tokens, completion tokens, unpriced calls, missing-FX calls, and
   **cost per AI reply** (sum of `AGENT_CALL` cost / count of
   `AiCreditUsage` REPLY rows - both sides keyed by the same turn ref, so
   retries and unsent replies land on both sides equally).
3. **Daily cost chart** for the selected month (IDR, from the daily
   snapshots).
4. **Model breakdown table**: model, calls, tokens in/out, cost USD, cost
   IDR, share %; inline price editor per model (input/output USD per 1M)
   and an "unpriced" badge when a model has calls but no price row. Price
   edits write `AdminActionLog`.
5. **Per-tenant table**: tenant, plan, AI replies (ledger), LLM cost
   (IDR), cost per reply, plan price, and cost as a % of plan price.
   Sortable by cost. A cost % above 100 is the operator's margin-loss
   flag - the page only surfaces it, it does not act.
6. **FX rate section**: the current rate, a list of recent daily rates
   (AUTO/MANUAL), and a manual add/correct form per day. Edits audited.

### `/admin` (Overview, owner decision 2026-11-27)

The main dashboard shows this month's LLM cost directly: two tiles in the
existing telemetry strip - "LLM cost (month)" in IDR and "LLM cost / AI
reply" - both linking to `/admin/llm-usage`. Served by the existing
`/api/admin/usage` call (extended), no extra request on page load.

### `/admin/plans` (existing usage table)

One added column: LLM cost (current month, IDR), linking to
`/admin/llm-usage`. `/api/admin/usage` gains the per-tenant LLM aggregate.

### API

- `GET /api/admin/llm-usage?month=YYYY-MM` - all aggregates above.
- `POST /api/admin/llm-usage/prices` (create/update one model price) -
  `requireAdmin` + `AdminActionLog`, matching existing admin route
  conventions. Decimal values cross the boundary as strings and are
  Zod-parsed.
- `POST /api/admin/llm-usage/fx` (add/correct one day's USD/IDR rate) -
  same conventions, audited.
- `/api/admin/usage` extended with `llmCostIdr`, `llmCostUsd`,
  `llmCalls`, `llmCostPerReply` (platform totals for the Overview tiles)
  and per-tenant `llmCostIdr`.

No tenant-facing page or endpoint changes.

## Security and audit

- `LlmUsage`, `LlmModelPrice`, and `FxRate` are operator-only. No tenant
  API exposes them; no tenant role can read cost data (it is the
  operator's margin information).
- Price and FX edits are audited (`AdminActionLog` actor + before/after).
- Usage rows carry no message content, no prompts, no secrets - only
  counts, model names, and refs.
- All queries are platform-scoped inside `withSystemContext` in admin
  routes, matching every existing admin endpoint.

## Migration and backfill

- Migration creates the three tables, the `LlmUsageSource` and
  `FxRateSource` enums. No backfill: token usage was never captured, so
  history starts at deploy. The credit ledger's history is untouched and
  still correct for quotas.
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
- With a price row and an FX rate set: `costUsd` matches the token
  formula to 8 decimals and `costIdr = costUsd * fxRateIdrPerUsd` to 4
  decimals; with no price row: null costs, and the admin page shows the
  unpriced count; with no FX rate: `costUsd` set, `costIdr` null, flagged.
- Historical rows are immutable: editing today's FX rate or a model price
  does not change any already-written `LlmUsage` row.
- Guard rows: a turn in `GUARD_MODE=shadow` writes 1 pre + 1 post `GUARD`
  row on the turn's ref; `GUARD_MODE=off` writes none.
- The worker's daily tick writes exactly one `FxRate` row per UTC day
  (idempotent upsert); a failed fetch reuses the latest rate and logs.
- `/admin/llm-usage` shows stat strip, daily chart, model breakdown with
  working price editor, FX section, and per-tenant cost table; `/admin`
  Overview shows the two LLM tiles; `/admin/plans` shows the LLM cost
  column.
- A tenant user (any role, any token) cannot reach any new endpoint or see
  any cost number.
- Price and FX edits each write an `AdminActionLog` row.

## Resolved decisions (owner, 2026-11-27)

1. **Cost basis**: USD per 1M tokens, IDR derived with the day's USD/IDR
   conversion rate. The rate is stored per day (`FxRate`) AND snapshotted
   per usage row, so old data keeps the rate that was actually applied
   and historical cost never drifts.
2. **Page shape**: dedicated `/admin/llm-usage` page + LLM cost column on
   Plans & Usage + two cost tiles on the admin Overview (main page), so
   usage/cost is visible directly on the admin dashboard.
3. **Guard calls**: included. Decisions API calls are recorded as `GUARD`
   rows on the turn ref; cost when the response exposes usage, otherwise
   counted and flagged unpriced.
4. **Tenant visibility**: tenants see nothing - credits remain their only
   meter; cost numbers are operator-only.
