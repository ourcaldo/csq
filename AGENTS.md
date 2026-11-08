# AGENTS.md - CSQ

## Project Status
Active project (HackFest origin is historical). Scaffolding through the agent runtime,
inbox, scenarios, and pipeline has landed; the agent runtime is a direct
OpenAI-compatible client (`packages/core/src/services/llm-runtime.ts`) - OpenClaw is gone.
**Read the PRD set in `docs/prd/` (start with its README) in full before making any architectural decision.**
**Owner decision 2026-11-08: the product escalates into a multi-frontend monorepo**
(public UI + tenant dashboard + later a platform admin console). Plan:
`docs/plans/2026-11-08-monorepo-migration-plan.md`, PRD section 23B.0. Architecture
decisions must follow that plan, not the older single-app statements in the
historical PRD sections.
**Phases 1-3 landed on branch `monorepo`: the app lives at `apps/dashboard/`, the public
landing at `apps/web/` (built, not yet deployed as its own service), shared domain
code (prisma, lib, services, tools, types) lives in `packages/core` imported as `@csq/core`,
and the repo root is an npm-workspaces manifest with proxy scripts. Production runs the
monorepo branch on the `csq-dashboard` Render service; merging to main still requires the
Render command cutover (see the migration plan).**
**Owner directive 2026-11-08 (testing phase): do NOT merge the `monorepo` branch into
`main`, do not propose it, do not start any related cutover, and do not retire or
reconfigure the old `csq` service - until the owner explicitly asks. The monorepo is
being tested first on its own Render service while the monolith on `main` stays as
production.**
**Owner decision 2026-11-08 (enterprise escalation): the product targets enterprise use,
not a single-owner tool.** Target architecture: `apps/api` (versioned /v1 contracts, token
auth, Tool Gateway, webhooks) and `apps/worker` (WhatsApp sockets, scheduler, campaign
engine - the ONLY socket owner) as separate services; the dashboard becomes UI + BFF.
Resilience requirement: a broken or deploying dashboard must never affect the API or the
customer-serving runtime. The single-process constraint is superseded - see PRD 23C and
`docs/plans/2026-11-08-enterprise-architecture-plan.md`.

## Infrastructure Topology and Touch Rules (owner directive 2026-11-08)

Two stacks run in parallel during the monorepo testing phase. Never confuse them.
When the owner says "production", "live", or the real WhatsApp, they mean the
monolith. When they say "monorepo", "the new dashboard", or "the clone", they
mean the testing stack.

| | Monolith (PRODUCTION) | Monorepo (TESTING) |
|---|---|---|
| Code | `main` (frozen) | `monorepo` branch (active development) |
| Render service | `csq` / `srv-dbjlj2p42hec73dcu53g` / https://csq-xmhq.onrender.com | `csq-dashboard` / `srv-dbo02jbrjlhs73a2375g` / https://csq-dashboard.onrender.com (UI + BFF) + `csq-worker` / `srv-dbo3kn7f3r2c73a3g8l0` / https://csq-worker.onrender.com (channel runtime: sockets, all ticks, outbox drain, connect/QR commands) + `csq-api` / `srv-dbo418jm8hqs73fgdl0g` / https://csq-api.onrender.com (product API: /api/v1 token realm, Tool Gateway, Meta webhook, media; API_SERVICE_TOKENS lives here, API_URL + API_SERVICE_TOKEN on the dashboard, API_URL on the worker) + `csq-admin` / `srv-dbo5a2lg1s2s73e8a53g` / https://csq-admin.onrender.com (platform console: its own AdminUser realm, tenant lifecycle, fleet, audit, plans) |
| Database | Neon project `CSQ` (`winter-flower-03790042`), default branch `br-billowing-base-b3cv56yi` (`ep-misty-boat-b3tteij7`) | same project, branch `monorepo` `br-still-queen-b3mydc3y` (`ep-lucky-paper-b35a5at7`) |
| WhatsApp session | the real one; lives here and ONLY here | none: clone channels are DISCONNECTED and cloned creds are deleted - keep it that way |

Rules:

- **Monolith**: do NOT deploy, restart, suspend, reconfigure, or change env
  vars on the `csq` service, and do NOT write to the production database
  branch, unless the owner explicitly asks for that exact action. Diagnostics
  (logs, metrics, read-only SQL) are fine.
- **`main` is frozen**: pushing to it auto-deploys the monolith, whose start
  command no longer matches the monorepo layout.
- **Monorepo**: fully agent-managed - push, deploy, env vars, SQL on the clone,
  even destructive resets on the clone, on request.
- **Every (re)clone for the monorepo MUST be neutered before the service points
  at it**, or the clone connects the SAME WhatsApp session and 440-fights
  production (the SystemLock lease cannot protect across two databases):
  1. `UPDATE "Channel" SET status = 'DISCONNECTED'`
  2. `DELETE FROM "BaileysAuth"`
  3. `DELETE FROM "SystemLock" WHERE key LIKE 'baileys-socket%'`
- Never repoint `csq-dashboard` at the production branch, never repoint the
  monolith at the clone, and never give the clone the real WhatsApp session -
  pair a second number on the clone instead if the owner wants isolated
  WhatsApp tests.
- Production bug fixes are developed on the `monorepo` branch; shipping
  anything to production needs the owner's explicit go.
- MCP ids: Render workspace `tea-d776rkea2pns73df0610`, Neon project
  `winter-flower-03790042`. Env still missing on csq-dashboard (owner sets):
  `LLM_*`, `GOOGLE_*`, `WHATSAPP_APP_SECRET`.

## What We Are Building
Self-hosted, multi-tenant AI agent platform for Indonesian UMKM. First agent: a Customer
Service Agent on WhatsApp that answers from the business's own messy data (manual entries,
Excel/CSV, Google Sheets) under strictly controlled permissions.

Core loop: Understand → Retrieve → Reason → Check Permission → Act → Verify → Record.
Core principle: **Read by default. Write by permission. Act by policy.**

## Agent Behavior - Senior Engineer, Not a Yes-Man
- **Never just agree.** If the plan is wrong, risky, over-scoped, or violates a PRD
  constraint, push back with the reason and a better alternative.
- **Never answer architecture questions anchored on "today's scale."** Evaluate every
  proposal against the product's target state (PRD 23C: enterprise, multi-client,
  resilient). "Not needed yet", "YAGNI", and "fine at current scale" are banned as
  standalone dismissals. If you see a real problem, argue it as explicit forward-looking
  trade-offs (cost, sequencing, risk) - never as "not for today". Disagreement is welcome;
  lazy framing is a process failure.
- **Confirm the trigger before building a triggered phase.** A plan phase marked
  "when X starts" is a question, not an approval - and signals (installed skills,
  stack choices, silence) are never product decisions. When the owner says "continue
  phase N", execute what is unambiguous and ASK about anything whose trigger condition
  was never actually confirmed by the owner. Lesson from 2026-11-08: the "mobile auth
  realm" was built on an inferred mobile roadmap that did not exist - the owner had no
  mobile app planned. The work was kept (it doubles as the API's user-token realm), but
  the inference was wrong and is recorded here so it is not repeated.
- When the user reports a specific failure, diagnose and fix THAT failure. Do not
  expand scope into adjacent subsystems unless the evidence proves they are the
  same root cause, and do not lecture about problems the user did not ask about -
  name them in one line if they block the fix, then move on.
- Non-trivial answers must be short and to the point, but still cover the four things
  that change decisions:
  1. Recommended process (how to proceed),
  2. What already exists / is already built,
  3. What is NOT recommended - and why,
  4. What we should do next (concrete next step).
- No fluff, no restating the question back. Detail belongs where it informs a decision,
  nowhere else.
- Fix bugs autonomously: point at logs/errors first, then fix the root cause. Zero
  hand-holding required from the user.

## Coding Style - Lazy Code That Works
Write the **least code that fully solves the task**. Boring beats clever.
- **NO em dashes (U+2014), en dashes (U+2013), or middle dots (U+00B7) anywhere in this
  repository** - not in code, comments, UI strings, docs, commit messages, or chat replies.
  Use a basic hyphen `-`, a comma, or a period instead. They are AI-writing tells,
  they look wrong in Indonesian text, and (history: the 2026-11-01 D10f mojibake)
  multi-byte dash characters are what gets corrupted when a file is re-saved with the
  wrong encoding. `npm run check:encoding` fails on them, so a violation breaks the
  build gate. Migration `.sql` files under `packages/core/prisma/migrations/` are the one frozen
  exception: their bytes are checksummed in `_prisma_migrations` and must never be
  edited after being applied.
- YAGNI is law. No speculative abstraction, no "might need later", no dead config or
  placeholder files.
- Duplicate once, extract on the third occurrence or when there are 2+ real callers -
  never before.
- Standard, idiomatic patterns only: vanilla Next.js/Prisma/Tailwind conventions, an
  established library over hand-rolled code (also matches the PRD's AI-assisted coding
  constraint).
- For non-trivial changes, pause once and consider a simpler approach; for simple fixes,
  just fix them. Never over-engineer.
- Clear names + consistent formatting beat comments. Comments explain WHY; code shows WHAT.
- Delete dead code and unused dependencies immediately.
- "Lazy" never means broken: the code must work, be understandable by someone else,
  and pass verification before it's called done.

## Workflow Rules

### Read Before Acting
- **STOP.** Before writing ANY code, making ANY edit, or running ANY command, read the
  relevant project context FIRST. This is not optional. Skipping this leads to incorrect
  approaches and wasted effort.
- At minimum: read this `AGENTS.md` and the PRD section relevant to the task.
- **This file and the PRD go stale between sessions. Before quoting any scope or
  architecture constraint at the owner, re-check the live PRD section and its git
  history (`git log -- <file>`). An owner's stated direction ALWAYS overrides cached
  documents - never push back with "not in scope" based on remembered text; verify
  first, then either comply or show the owner the exact contradicting line.**
- When scaffolding exists: read the Prisma schema before touching data queries; read
  existing API routes before adding new ones; read existing components before building
  new UI; read existing tool definitions before adding new tools.
- If you find yourself about to edit a file without understanding how it fits, STOP and
  read it first.

### Plan Before Non-Trivial Work
- Enter plan mode for any non-trivial task (3+ steps, architectural decisions, schema
  changes, auth flow, tool permissions).
- State the plan before coding. Write checkable items. Mark them complete as you go.
- If something goes sideways mid-task, STOP and re-plan immediately - don't keep going
  on a broken plan.

### Subagent Strategy
- Use subagents liberally for research, exploration, and parallel analysis. One task
  per subagent.
- Keep the main context window clean - offload file searches, doc lookups, and
  exploration work to subagents.

### Verification Before Done
- A task is NOT complete until verified:
  1. `npm run build` passes with no errors.
  2. Lint passes (once configured).
  3. For UI changes: verify the page renders correctly.
  4. For API/tool changes: verify the endpoint responds correctly.
- Never mark a task complete by assumption. Demonstrate it works.

### After Code Changes - Build + Verify
- After changes to app code (NOT docs/config-only):
  1. `npm run build` to verify no errors.
  2. Restart dev server if needed (`npm run dev`).
  3. Verify output and terminal logs after restart.
- This is SEPARATE from git commit. Build verifies correctness; commit saves it.

### Self-Improvement Loop
- After ANY correction from the user, capture the lesson: update this `AGENTS.md` with the
  pattern and a rule to prevent recurrence.
- Review existing rules and lessons at the start of each session.

## Engineering Rules

### 1. Root Causes Only - No Band-Aid Fixes
- Always find and fix the root cause. Never apply temporary workarounds or band-aids.
- When fixing a file, check ALL other files that import from or depend on the changed
  code. Trace the full impact before declaring "done."
- Senior developer standard: would a staff engineer approve this change?

### 2. Strict Type Safety - No `as` Casting
- **NEVER** use `as any`, `as unknown`, or any `as` type assertion. All values must use
  their real types.
- Data values must match local TypeScript interfaces/types. If a type mismatch exists,
  fix the type definition or the data flow - never cast around it.
- Use Zod schemas at every external boundary (API routes, tool calls, WhatsApp webhook
  payloads, Google Sheets data, Excel import). `z.infer<typeof schema>` is the source of
  truth for request/response shapes.

### 3. External Service Proxy Rule - Zero Direct Calls
- **NEVER** put secret-bearing external integrations directly in browser/client code.
- External interactions requiring secrets go through server-side handlers/API routes:
  `Client UI → Server handler → External Service`.
- Allowed client-side exceptions are limited to non-secret-safe interactions explicitly
  required by product design.
- When reviewing code that touches an external service, **verify the call goes through
  an API route**. If it doesn't, fix it.
- Centralize fetch/client logic for external services in dedicated server-side modules.
  Don't scatter HTTP calls across routes.

### 4. Security
- Never commit secrets/tokens to the repo. `.env` is gitignored - always.
- Keep environment files private. Define environment variables explicitly - no secret
  leaking to client bundles.
- Sanitize or safely render any user-supplied content (customer messages, uploaded
  documents, spreadsheet data). Treat all external content as untrusted - this is
  prompt-injection defense.

### 5. Integration Points
- When adding external integrations (WhatsApp Cloud API, Google Sheets, OpenClaw):
  - Define env vars explicitly in `.env.example` and a central config module.
  - Centralize the client/fetch logic in dedicated modules per integration - don't
    scatter it across API routes.
  - One module per integration. Clean interface, clear error handling.

### 6. Git Discipline (once repo is initialized)
- **Conventional commits** (`feat:`, `fix:`, `chore:`, `docs:`) with proper type,
  scope, and description.
- One logical change per commit. No batching unrelated changes.
- **Commit automatically after a verified unit of work - do NOT wait for the user
  to ask.** Once `npm run build` (+ lint) passes, stage the relevant files and
  commit with a conventional message. Do not say "nothing committed yet" or ask
  permission to commit. Push if the repo auto-deploys (this one does).
- Use `git add` (not `-A` blindly) - be aware of what's being staged.
- **Verification flow** after code changes:
  1. `npm run build` - confirm no errors
  2. Stage changed files
  3. Commit with conventional message (end with the Co-Authored-By trailer)
  4. Push

### 7. Generated Documents
- All generated documents live under `docs/`, organized by kind: `prd/` (the PRD
  set), `specs/` (SRS, SDD), `plans/` (implementation plans), `report/` (status
  reports, audits, registers), `research/` (discussions, notes), `marketing/`
  (content), plus `assets/`, `demo/`, `diagrams/` for media. Never park a document
  loose at the `docs/` root - give it its directory.
- Use descriptive filenames with date prefix when relevant:
  e.g. `docs/plans/2026-11-08-shared-ui-package-plan.md`.
- Create the `docs/` folder if it doesn't exist. Don't scatter generated docs across
  the repo.
- **Specs are focused documents; only changelogs are dumps.** The PRD lives as a set
  under `docs/prd/` - one concern per file, indexed by its README. A new decision amends
  the focused file it concerns (dated, in place) or gets its own file - it is NEVER
  appended to an unrelated growing document. When a document accumulates sections from
  multiple unrelated decisions, raise the split proactively. Lesson from 2026-11-08:
  the PRD grew into a 1950-line, 35-section monolith across three separate escalations,
  each appended because "that is where the PRD lives" - the owner had to demand the
  split. The accumulation was visible from the second escalation onward.

### 8. Project Scope
- Work only in this project's directory. Don't touch files outside it unless explicitly
  asked.
- Keep docs and instructions comprehensive - do not reduce them to minimal stubs.

### 9. Core Principles
- **Simplicity First**: Make every change as simple as possible. Minimal code impact.
- **No Laziness (in fixes)**: Find root causes. No temporary fixes or workarounds.
- **Minimal Impact**: Changes touch only what's necessary. Avoid introducing bugs.
- **Full Traceability**: When changing shared code, verify all consumers still work.

### 10. Production-Ready and Scalable - No "MVP-Only" Excuses
- **Every line ships to production standard.** Never justify a flawed or
  unscalable design with "it's fine for the MVP" / "we'll fix it later" / "good
  enough for now." If a design does not scale or is not production-correct, it
  is wrong - fix the design, not the framing.
- "Lazy code that works" (see Coding Style) means *minimal code*, never
  *minimal rigor*. The least code that **fully and correctly** solves the task
  at production scale - not the least code that demos.
- If you catch yourself or anyone proposing a shortcut that won't scale (unbounded
  loops, unbounded prompt growth, N+1 queries, no locking, no tenant filter,
  silent failure, hardcoded caps that silently drop work), STOP and redesign.
  Surface the scaling problem explicitly; do not bury it.
- Context that grows with data must be **retrieved on demand, not bulk-loaded**.
  Specifically: business knowledge (FAQs, policies, business info) is **not**
  dumped wholesale into the agent's system prompt every turn. Only small,
  always-relevant, stable context (persona, owner instructions, safety rules, a
  bounded set of core facts) belongs in the prompt. Everything else is fetched
  via retrieval tools (`knowledge.search` over pgvector) when the agent needs it,
  so prompt size stays bounded regardless of how much knowledge the tenant owns.
- When the proper scalable design depends on an unfinished piece (e.g. retrieval
  requires the embedding pipeline), the correct response is to **build the
  dependency**, not to paper over it with an unscalable substitute. Track the gap
  explicitly (see `docs/report/`) until it is closed.

## Stack - Fixed Constraints (do not substitute)
- **Next.js with Pages Router - NOT App Router.** This is an explicit PRD decision; do not
  scaffold with App Router or suggest migration.
- **Superseded 2026-11-08 (enterprise escalation): the single-process constraint is dead.**
  Target: separate services - `apps/dashboard` (UI + BFF), `apps/api`, `apps/worker` - per
  PRD 23C and `docs/plans/2026-11-08-enterprise-architecture-plan.md`. Pages Router stays for
  every Next.js app; Postgres stays the only data store (no Redis/queue).
- UI: Tailwind CSS + shadcn/ui. Auth: Auth.js (NextAuth), email/password for MVP.
- PostgreSQL + Prisma + **pgvector** (same Postgres instance; no separate vector DB -
  no Pinecone/Weaviate/Redis/task queue).
- Data ingestion: `exceljs` or `xlsx` for Excel/CSV; `googleapis` for Google Sheets (OAuth).
- Agent runtime: **OpenClaw** (HackFest requirement). Integration method (HTTP webhook vs
  SDK process) NOT yet validated - verify against OpenClaw docs before finalizing backend
  layout.
- Channel: WhatsApp is **pluggable** - Cloud API (official, ToS-safe, free test
  number, 24h reply window + templates for outbound) and Baileys
  (bring-your-own-number via QR, full parity, ToS/ban risk, opt-in with a UI
  warning). Owner chooses at onboarding; both built in the MVP. The dashboard
  includes a CRM/inbox (shared inbox, assignment, tags, human/AI handoff) for
  owner + staff (OWNER/STAFF roles).
- Deployment: Docker Compose on Ubuntu VPS - **4 vCPU / 4GB RAM / 20GB SSD**. Keep
  process count minimal; `node-cron` in-process for Sheets sync.

## Architecture Rules
- Four layers: Dashboard → Business Context Layer → OpenClaw Runtime → Customer Channel
  (WhatsApp).
- The **Tool Gateway** (Next.js API routes) is the only path between agents and business
  data. Agents call controlled tools (`get_product`, `update_stock`, `create_order`,
  `search_knowledge`...), never databases or external APIs directly.
- Every tool call must be: tenant-scoped, agent-scoped, permission-checked, audited,
  validated.
- Data authority: track source, timestamp, last sync, priority per source. On conflict,
  prefer authoritative source; if unresolvable, escalate to human - never invent an answer.
- **Agent context is bounded and retrieved on demand (production-scalability rule).**
  The system prompt carries only small, stable, always-relevant context: persona,
  owner instructions, safety rules, and a bounded set of core business facts.
  FAQs, policies, and any knowledge that grows with the tenant are **not**
  bulk-loaded into the prompt - the agent fetches them via retrieval tools
  (`knowledge.search` over pgvector) during the turn. Prompt size must stay
  bounded regardless of tenant knowledge volume. Bulk-loading knowledge into the
  prompt every turn is a scaling defect, not an MVP shortcut (see rule 10).

## Security - Non-Negotiable
- **Every table gets a `tenant_id` column from day one.** All queries and tool calls
  filter server-side by `tenant_id`. Postgres RLS is a second enforcement layer.
- Never infer owner/admin status or permissions from conversation content. Bind WhatsApp
  identities to tenant+role via verified platform config only.
- External content (customer messages, spreadsheet cells, uploaded docs) is untrusted -
  prompt-injection defense is a requirement.
- Agents read-only by default. Write is a per-tool permission (`product.update`,
  `inventory.update`, `order.create`...), tool-based not file-based. Selected actions
  additionally require owner approval.
- Never expose raw DB credentials or Google OAuth tokens to the model. Log every mutation
  (before/after values, approval status) for the audit trail.
- One OpenClaw Gateway/cell per tenant for isolation (MVP runs only one tenant, but keep
  schema and architecture multi-tenant-ready).

## Explicitly Out of Scope (do not build)
SaaS hosting/billing, hosted tenant provisioning, Shopee/Tokopedia/Instagram integrations,
full accounting/ERP, autonomous refunds, advanced multi-agent collaboration, arbitrary DB
connectors, website chat / Telegram / Messenger channels (future only).

## Gotchas
- Windows dev machines; deployment target is Linux VPS via Docker Compose + Nginx +
  Certbot (TLS required for WhatsApp webhook).
- MVP demos a single tenant (Toko Kopi Nusantara) even though the schema is multi-tenant.
- Demo success hinges on the safety moment: agent must refuse an unauthorized price change
  from a customer message. Preserve this behavior in any refactor.
- **NEVER state third-party platform rules (pricing, limits, windows, template policy) from
  memory.** Training data lags fast-moving platforms: WhatsApp moved to per-message billing
  (2025-07-01) and made in-window service replies billable (2026-10-01) - the owner had to
  challenge an outdated claim on 2026-11-01 before it was caught. Fetch the current official
  docs (developers.facebook.com for WhatsApp) and quote them before asserting any platform
  behavior that affects a design decision.

## MCP Servers and Skills - Use Them When Relevant

This workspace has MCP servers and skills configured. They are part of the workflow,
not optional extras. Treat "didn't know it existed" as a process failure, same as
skipping the Read-Before-Acting rule.

### Context7 - library/framework documentation (preferred over web search for docs)

Use the `context7` MCP server whenever you need current docs for a library, framework,
SDK, API, CLI, or cloud service - even well-known ones (Next.js Pages Router, Prisma,
Auth.js/NextAuth, shadcn/ui, `exceljs`, `googleapis`, `node-cron`, pgvector). Training
data lags; docs don't.

Flow: `mcp__context7__resolve-library-id` (name → library ID) →
`mcp__context7__query-docs` (library ID + one specific concept).

- **Always do this before finalizing the OpenClaw integration** (PRD §23A flags the
  integration method as unresolved) and before locking pgvector/Prisma raw-SQL patterns.
  These are the two highest-risk unknowns in the project.
- One concept per `query-docs` call. Don't combine unrelated topics.
- Do NOT use Context7 for: refactoring, writing scripts from scratch, debugging business
  logic, code review, or general programming concepts.

### Firecrawl - web search and page retrieval

Use the `firecrawl` MCP server for live web research Context7 doesn't cover (WhatsApp
Cloud API webhook setup, Meta for Developers test-number limits, OpenClaw docs when not
in Context7, current pricing/rate limits, deployment guides).

Match the tool to the task:
- `firecrawl_search` - find sources on the web.
- `firecrawl_scrape` - retrieve one known URL (markdown/HTML/JSON).
- `firecrawl_map` - enumerate a site's URLs without fetching content (find the right doc page).
- `firecrawl_crawl` - collect many pages from one site.
- `firecrawl_extract` - structured extraction from URLs with a JSON schema.
- `firecrawl_agent` - multi-source research; read the result with `firecrawl_agent_status`
  (takes minutes, non-blocking).
- `firecrawl_parse` - parse a local PDF/DOCX/XLSX into markdown (relevant to the demo's
  `return-policy.pdf` / `shipping-policy.pdf` ingestion path, PRD §21 Step 4).

Prefer Context7 for library docs; reach for Firecrawl when you need the live web or a
specific page. Don't fetch a URL with Firecrawl if Context7 already has the library.

### Skills - invoke when the task fits

Skills are available via the `Skill` tool. Invoke the moment the task matches - do not
reinvent what the skill already encodes. Relevant ones for this project:

- **`firecrawl`** - read before heavy scraping/parse work; routes to the right usage path.
- **`frontend-design`** - before building new dashboard UI or reshaping existing UI
  (aesthetic direction, typography, non-templated choices). Read before the first line of UI code.
- **`dataviz`** - before ANY chart/graph/dashboard visualization, in any medium. Read
  before choosing colors, building stat tiles, or laying out a dashboard.
- **`run`** - launch and drive the app to confirm a change works in the real app, not just tests.
- **`security-review`** - security review of pending changes. Run before merging anything
  touching auth, tool permissions, webhooks, or tenant isolation.
- **`simplify`** - review changed code for reuse/simplification/efficiency and apply fixes
  (quality only - not bug-hunting; use `security-review` or code review for that).
- **`fewer-permission-prompts`** - after a few sessions, scan transcripts and allowlist
  common read-only Bash/MCP calls in `.claude/settings.json`.
- **`update-config`** - for `settings.json`/hooks/permissions changes. Note: any
  "from now on when X, do Y" automation requires a hook in settings.json - the harness
  executes it, not memory or this file.
- **`loop`** - recurring task/polling (e.g. "check the deploy every 5 minutes").
- **`claude-api`** - reference for the Claude/Anthropic API; read before working with
  model IDs, pricing, tool-use, or MCP/agent definitions.
- **`init`** - regenerate/refresh `CLAUDE.md` from the codebase when the project structure
  changes materially (e.g. after Phase 0 scaffolding lands).

When a skill's guidance conflicts with this `AGENTS.md`, this file wins for engineering
rules; the skill wins for its own domain (UI design, charts, security-review methodology).
