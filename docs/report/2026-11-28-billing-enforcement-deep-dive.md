# Billing & Plan Enforcement Deep Dive (owner request 2026-11-28)

Status: report only. No code changed. Two parallel read-only audits were run:
every tenant dashboard action vs `getTenantEntitlements`/`credits.ts`, and
every runtime spend path (worker, api, core engines) vs the plan. Evidence
is file:line, static, on branch `monorepo` as of commit `793e899`.

## 1. Executive summary

Billing IS real - but enforcement is narrow. The plan gates exactly four
things end to end: channel connects, staff invites, the three premium
features (campaigns/scenarios/pipeline), and AI replies (credit hard stop).
Everything else a tenant does is unmetered or unbounded, and the credit
hard stop covers ONLY the agent reply path - scenarios keep spending LLM
money at 0 credits, and guard/embedding/template spend is invisible to
billing. Two findings are P0: staff can read invoices and bank details,
and the "no plan = unlimited legacy" rule contradicts the owner's
directive that a tenant without a plan must not be able to grow.

Clone reality check (2026-11-27): 3 tenants; Toko Kopi Nusantara is on
Basic (Rp 500.000, 15.000 credits, MAU 1.000, 4 staff, 2 channels) and is
at its 2/2 channel cap - the cap works. ATTCOS has NO plan and is
unlimited in every dimension, which is the policy problem in section 7.1.

## 2. What PRD 14 promises

- Entitlements: `aiCreditsPerMonth`, `mauLimit` (meter only, never blocks),
  `staffLimit` (owner excluded), `channelLimit` (CONNECTED only),
  `features[]` (campaigns/scenarios/pipeline). NULL = unlimited.
- **No plan = legacy = unlimited and every feature** (PRD 14 line 23).
- Credits: 1 per AI reply, 1 per scenario module; hard stop at 100% before
  the LLM call; ledger idempotent per `(tenantId, source, refId)`.
- Invoices manual; overdue is computed, never auto-suspends.
- Security: "Tenant billing endpoints are OWNER-only. STAFF must not see
  invoices or amounts."

## 3. Enforcement matrix (tenant dashboard actions)

| Action | Plan rule | Verdict | Evidence |
|---|---|---|---|
| Connect/reconnect channel | channelLimit | ENFORCED | `channels/connect.ts:158-175`; already-connected reconfigures bypass; at-limit returns error with plan name |
| Disconnect/archive/delete channel | frees a slot | correctly un-gated | `channels/disconnect|archive|delete.ts` |
| Invite staff | staffLimit | ENFORCED, TOCTOU-safe | `team/invite.ts:122-171` (advisory lock, pending invites counted); re-checked at accept (`team/accept.ts:94-127`) |
| Change role / remove member | no seat consumed | correctly un-gated | `team/[id].ts` |
| Campaigns (all 6 API routes + 3 pages + nav) | feature | ENFORCED | `requireFeatureApi` + `withFeature`; worker pauses at fire (`campaign-engine.ts:101-116`) |
| Scenarios (6 routes + pages + nav) | feature | ENFORCED | same pattern; engine fails runs (`scenario-engine.ts:295-300`) |
| Pipeline (7 routes + pages + nav + inbox badges) | feature | ENFORCED | `pipeline/*`; inbox stage badge/section hidden when off |
| DEALS_WON KPI target | pipeline | ENFORCED | `kpi/targets/index.ts:122-128`; metric immutable on PATCH |
| Agent turns (reply) | credits hard stop | ENFORCED (agent path only) | `agent-loop.ts:201-243`; stands down before LLM; 1 audit row/conversation/month |
| Scenario modules | credit charge | CHARGED, never STOPPED | `scenario-engine.ts:349-358`; no `getCreditStatus` anywhere in the scenario path |
| Scenario AI node LLM calls | 1 module credit | CHARGED flat, unmetered tokens | `scenario-engine.ts:511-536` -> `llm.ts` |
| Guard Decisions calls (2+/turn) | none | NOT charged, NOT gated | `guardrail.ts`; `LlmUsage` GUARD rows only (PRD 33) |
| Knowledge create/upload/search embeddings | none | NOT charged, NOT capped | `knowledge/*`, `embeddings.ts` |
| Human inbox replies, API sends, campaigns | none (by PRD) | correctly un-charged | `chargeCredits` only exists in agent-loop + scenario-engine |
| Create agents | none | NOT ENFORCED (no limit exists) | `agents/index.ts`; no `agentLimit` plan field |
| Products/orders/contacts/tags/categories | none | NOT ENFORCED (no limits exist) | zero entitlement hits |
| Media upload | none (5-10 MB per file) | NOT ENFORCED (no tenant quota) | admin sees bytes; tenant never blocked |
| API keys mint | none | NOT ENFORCED (no limit) | `api-keys/*` |
| Plan request | one open request | ENFORCED | `billing.ts:138-145` + DB unique guard |
| Suspension | lockout | ENFORCED | SSR -> `/suspended`; BFF 401; API 401; runtime stand-downs (see 4) |
| Invoice overdue | banner only | PARTIAL | flag exists owner-only; no shell banner, no action |
| Viewing billing/invoices | OWNER-only per PRD | **VIOLATED - P0** | `GET /api/dashboard/billing` has no owner gate; `pengaturan/paket.tsx` is deep-linkable by staff; both expose amounts + bank details |

## 4. Runtime (worker/api) findings

4.1 Agent path: the credit check runs BEFORE the guard pre-check and the
LLM call, exhaustion dedupes audit rows per conversation per month, and
the charge after the LLM is idempotent. Correct. Known soft edges
(deliberate, per PRD): fail-open if the credit read throws
(`agent-loop.ts:204-221`, audited), post-send charge failure audited
(`:465-477`), concurrency overshoot by concurrent turns.

4.2 Scenario path is the biggest billing hole: feature gate works, module
credits are charged, but **nothing ever checks the balance**. A tenant at
or past 100% credits keeps executing scenario nodes and AI LLM calls
indefinitely (`scenario-engine.ts:330` loops to 48 nodes per advance with
no balance check). PRD 14's "hard stop at 100%" exists only in
`runAgentReply`.

4.3 Campaign engine: feature gate pauses at fire with an audit row;
campaign sends are uncharged (per PRD). **Contradiction with PRD 14 line
139-140**: in-flight queued rows do NOT drain - `deliverOne` skips PAUSED
campaigns (`campaign-engine.ts:290`), the stale-SENDING sweep bounces rows
back to PENDING forever, and runs stay permanently open. Either the code
must drain-and-close or the PRD sentence is wrong.

4.4 Suspension gaps (tenant SUSPENDED but still spends/receives):
- Non-text courtesy replies are sent with no check (`agent-outbox.ts:234-282`,
  called from webhook and Baileys).
- Pre-suspension outbox rows still deliver (`outbox.ts:85-163`, no
  tenantActive).
- Stand-down fallback fires before the suspension check
  (`agent-loop.ts:33-80, 162-185`).
- Approval follow-ups unguarded (`agent-outbox.ts:290-342`, latent).
- Sheets sync keeps running for suspended tenants (read-only spend).
PRD 16 SEC-4 says all outbound is suppressed; these five paths are not.

4.5 `/api/v1/messages`: suspension enforced at auth, 24h window enforced,
channel must be connected, 60 req/min rate limit. No plan-feature, credit,
or channelLimit check - correct, since it neither connects channels nor
generates AI replies. It is an unmetered WhatsApp send channel, which
matters only if the owner decides to bill template/API sends.

4.6 MAU: meter only, verified never gates any action. Correct per PRD 14.

4.7 Embeddings: every knowledge write/search embeds with no cap, no
credit charge - tracked as `LlmUsage` cost (PRD 33) but free to the
tenant and unbounded. Cheapest plan can embed a library for Rp 0.

## 5. Spend that billing never sees (margin view, per PRD 33 data)

Per AI reply, the platform pays: 1-3 LLM calls (tool loop), 2+ guard
Decisions calls, 0-2 query embeddings (knowledge.search), and the WhatsApp
send. Billing charges exactly 1 credit. Cost telemetry (PRD 33) records
the first three as `LlmUsage`; the guard calls and embeddings are
therefore visible in the admin LLM Usage page but are NOT covered by any
credit or cap. Template sends (session close, agent-inactive, campaigns)
carry real Meta per-message cost with no metering anywhere.

## 6. What is dead or display-only

- `mauLimit`: meter + banner only (by design; PRD 14).
- `Plan.priceIdr`: display; invoices are manual.
- No plan field is entirely unused, but `aiCreditsPerMonth` is enforced on
  a single path (agent replies), and there is NO plan field for: agents,
  media/storage, API keys, knowledge volume, template/API sends.

## 7. Owner decisions needed

7.1 **No-plan policy (P0, policy).** Your directive: "when user didn't
have any plan, they can't add a channel". PRD 14 line 23 says the
opposite (legacy = unlimited). Today ATTCOS (no plan) is unlimited.
Options:
  a. End legacy: no plan = no NEW channels, no NEW staff, premium features
     off; existing data and the first channel keep working (read/write
     what exists, grow nothing). Recommended.
  b. Hard trial: no plan = first channel only + core inbox; everything
     else off.
  c. Keep PRD 14 as is.
Note: whatever is chosen, the production monolith is a different database;
this change affects the monorepo/clone first.

7.2 **Scenario credit stop (P0, money).** Add the same `getCreditStatus`
hard stop to the scenario engine (pause the run, like suspension does) so
an exhausted tenant cannot keep burning scenario LLM calls. Recommended.

7.3 **Billing visibility fix (P0, security).** Gate `GET
/api/dashboard/billing` and the paket page to `billing.lihat` so staff
cannot read invoices and bank details. This is a PRD 14 compliance bug,
not a new decision.

7.4 **Suspension outbound holes (P1).** Add tenantActive guards to
non-text courtesy, outbox drain, stand-down fallback, approval follow-ups
(and optionally Sheets sync). PRD 16 says this already shipped; it has not.

7.5 **Campaign stranded rows (P1).** Decide: drain-then-pause (PRD text)
or hold-forever (current code); then fix the other one.

7.6 **Unmetered spend - charge or accept (P2, pricing).** Guard calls,
embeddings, template/API/campaign sends. PRD 33 already shows their cost
in the admin LLM Usage page. Options: fold into the credit price, add new
credit sources, or accept as margin cost with visible telemetry.

7.7 **New plan fields (P2).** storageBytes, agentLimit, apiKeyLimit,
knowledgeEntryLimit - only if real tenants hit these; today none are
limited anywhere.

7.8 **Overdue enforcement (P2).** Currently informational. Options:
shell banner for owners (cheap, matches PRD intent), or block specific
actions on overdue (reconnect channel? create campaigns?) - the latter
needs a policy decision.

## 8. Verification plan (when fixes are approved)

- 7.1: on the clone, as no-plan ATTCOS: connect a channel (expect block),
  invite staff (expect block), open campaigns (expect redirect), confirm
  existing channel still ingests and the owner can still request a plan.
- 7.2: set a test tenant to 0 remaining credits, trigger a scheduled
  scenario, assert the run parks with an audit row and no `LlmUsage` rows
  appear for it.
- 7.3: as STAFF, GET `/api/dashboard/billing` (expect 403) and open
  `/dashboard/pengaturan/paket` (expect redirect); as OWNER both work.
- 7.4: suspend a tenant, send a non-text message to it (expect no
  courtesy reply), confirm pre-queued outbox rows do not deliver.
- 7.5: queue campaign rows, downgrade the plan mid-run, assert the run
  closes with a documented end state.
- All under the standing gates: local tsc/lint/encoding, Daytona build,
  clone DB, live verify, no production monolith touches.
