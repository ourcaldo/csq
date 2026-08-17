# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

Greenfield HackFest MVP. **No code exists yet** — only the PRD and a phased plan set. Phase 0 (scaffolding) is the first implementation work. Until it lands, there is no `package.json`, no build/lint commands, and no Prisma schema. When scaffolding lands, update this file and `AGENTS.md` with the actual commands and directory layout.

## Read This First — In This Order

1. **`AGENTS.md`** — authoritative engineering rules, workflow, and coding style. It overrides anything generic. Re-read at the start of every session.
2. **`docs/prd-product-requirements-document.md`** — read in full before any architectural decision. Every constraint here traces back to a PRD section.
3. **`plans/00-master-plan.md`** — phase ordering and critical path. The task you're doing maps to a phase; open that phase's file for the checklist.

Do not act without having read the relevant project context first. This is non-negotiable in `AGENTS.md`.

## What We Are Building

Self-hosted, multi-tenant AI agent platform for Indonesian UMKM. HackFest MVP = one Customer Service Agent on WhatsApp that reads the business's own messy data (manual entries, Excel/CSV, Google Sheets) and performs controlled writes under per-tool permissions. The dashboard also includes a CRM-style shared inbox (chat panel, assignment, tags, human/AI handoff) where owner + staff handle conversations alongside the AI; WhatsApp connects via a pluggable provider (Cloud API official, or Baileys bring-your-own-number).

Core loop: **Understand → Retrieve → Reason → Check Permission → Act → Verify → Record.**
Core principle: **Read by default. Write by permission. Act by policy.**

## Architecture (big picture)

Four layers, end to end:

```
UMKM Dashboard (Next.js Pages Router)
      ↓
Business Context Layer (normalizes Excel / Sheets / manual / docs into one interface)
      ↓
OpenClaw Agent Runtime (agent execution, sessions, skills, tool calling, per-tenant cell)
      ↓
Customer Channel (WhatsApp Cloud API)
```

- **Single Next.js process** (Pages Router) serves both the dashboard UI and the Tool Gateway API routes. No separate backend service, no monorepo.
- **Tool Gateway** (`/api/tools/*`) is the *only* path between agents and business data. Agents never touch the DB or external APIs directly — they call controlled tools (`get_product`, `update_stock`, `create_order`, `search_knowledge`, …). Every tool call is tenant-scoped, agent-scoped, permission-checked, audited, Zod-validated.
- **Tool Gateway is the critical-path bottleneck** (master plan): nothing talks to the agent until Phase 5 lands.

### Stack — fixed, do not substitute (PRD 23A)

- **Next.js Pages Router — NOT App Router.** Explicit PRD decision. `create-next-app` defaults to App Router and must be declined.
- UI: Tailwind + shadcn/ui. Auth: Auth.js (NextAuth), email/password for MVP.
- PostgreSQL + Prisma + **pgvector** on the *same* Postgres instance (no separate vector DB, no Redis/queue).
- Data ingestion: `exceljs`/`xlsx` (Excel/CSV), `googleapis` (Google Sheets OAuth).
- Agent runtime: **OpenClaw** (HackFest requirement). Integration method (HTTP webhook vs SDK process) and 4GB-RAM footprint are **unresolved** — validate against OpenClaw docs before finalizing backend layout.
- Channel: WhatsApp is **pluggable** — Cloud API (official, ToS-safe, 24h reply window + templates for outbound) and Baileys (bring-your-own-number via QR, full parity, ToS/ban risk, opt-in with a UI warning). Owner chooses at onboarding; both built in the MVP. Multi-staff (OWNER/STAFF roles) and a CRM inbox are in scope.
- Deploy: Docker Compose on Ubuntu VPS — 4 vCPU / 4GB RAM / 20GB SSD. `node-cron` in-process for Sheets sync. Nginx + Certbot for TLS (required by the WhatsApp webhook).

### Target repository layout (PRD 23B.1 — created in Phase 0)

```
src/
├── pages/
│   ├── dashboard/        # authenticated dashboard, protected via withAuth HOC (no middleware)
│   └── api/
│       ├── tools/        # Tool Gateway — agent-facing, permission-checked, audited
│       ├── webhooks/whatsapp.ts
│       └── import/       # excel/csv upload, sheets oauth callback
├── lib/
│   ├── db.ts             # Prisma client singleton
│   ├── auth.ts           # NextAuth config + withAuth HOC
│   ├── permissions.ts    # capability check used by EVERY tool
│   └── vector.ts         # ALL pgvector raw SQL goes here — never raw SQL outside this file
├── tools/                # tool definitions + handlers; index.ts is the registry
├── services/             # external integrations, ONE module each (whatsapp, sheets, excel, openclaw)
└── types/                # shared TypeScript types + Zod schemas
prisma/                   # schema.prisma (tenant_id on every model), migrations, seed.ts
docker/                   # Dockerfile, docker-compose.yml (prod), docker-compose.dev.yml (pgvector)
docs/                     # all generated markdown (plans, audits, research)
```

## Commands (planned — active after Phase 0)

```
npm run build        # primary correctness gate — every phase ends with this passing
npm run lint         # zero errors
npm run dev          # dev server
npx prisma migrate dev --name <name>   # schema migrations
npx prisma db seed                     # demo tenant: Toko Kopi Nusantara
docker compose -f docker/docker-compose.dev.yml up -d   # local pgvector Postgres
```

No test framework initially. Add Vitest later only for modules that genuinely need unit tests (e.g. `permissions.ts`). Single-test pattern will be documented here once Vitest lands.

## Non-Negotiable Constraints (the ones that cost the most if missed)

- **`tenant_id` on every table from day one.** All queries and tool calls filter server-side by `tenant_id`; Postgres RLS is a second layer. Never infer tenant/role from conversation content.
- **No `as` type assertions** — no `as any`, `as unknown`. Use Zod at every external boundary (API routes, tool calls, webhooks, Sheets/Excel data); `z.infer<typeof schema>` is the source of truth.
- **Secrets never in client code.** External integrations go `Client → Server handler → External Service`. One service module per integration, centralized — no scattered fetch calls.
- **Vector ops only through `lib/vector.ts`** (`upsertEmbedding` / `findSimilar` / `deleteEmbedding`). Prisma declares columns as `Unsupported("vector")`; actual type is `vector(1536)` (or the embedding model's dimension). The `CREATE EXTENSION vector` lives in the first migration.
- **Dashboard auth via `withAuth(getServerSideProps)` HOC** — no Next.js middleware.
- **Agents read-only by default.** Write is a per-tool permission (`product.update`, `inventory.update`, `order.create`…); selected writes require owner approval. Every mutation is logged (before/after, approval status).
- **Demo safety moment is sacred:** the agent must refuse an unauthorized price change from a customer message. Preserve this in any refactor.

## Out of Scope — Do Not Build

SaaS hosting/billing, hosted tenant provisioning, Shopee/Tokopedia/Instagram, full accounting/ERP, autonomous refunds, advanced multi-agent collaboration, arbitrary DB connectors, website chat / Telegram / Messenger channels. See PRD §20 and `AGENTS.md`.

## Gotchas

- Windows dev machines; deploy target is Linux VPS via Docker Compose + Nginx + Certbot.
- MVP demos a single tenant (Toko Kopi Nusantara) even though the schema is multi-tenant-ready.
- Dev Postgres must be the `pgvector/pgvector:pg16` image — plain `postgres` lacks pgvector.

---

## Using MCP Servers and Skills

This project has MCP servers and skills configured. Use them when relevant — they are part of the workflow, not optional extras.

### Context7 — library/framework documentation (preferred over web search for docs)

Use `context7` whenever you need current docs for a library, framework, SDK, API, CLI, or cloud service — even well-known ones (Next.js, Prisma, Auth.js, shadcn/ui, `exceljs`, `googleapis`, `node-cron`, pgvector). Training data lags; docs don't.

Flow: `mcp__context7__resolve-library-id` (name → library ID) → `mcp__context7__query-docs` (library ID + specific concept).

- **Always do this before finalizing the OpenClaw integration** (PRD §23A flags the integration method as unresolved) and before writing pgvector/Prisma raw-SQL patterns — these are the two highest-risk unknowns.
- One concept per `query-docs` call. Don't combine "auth and routing and caching" into one query.
- Do **not** use Context7 for: refactoring, writing scripts from scratch, debugging business logic, code review, or general programming concepts.

### Firecrawl — web search and page retrieval

Use `firecrawl` for live web research that Context7 doesn't cover (e.g. WhatsApp Cloud API webhook setup, Meta for Developers test-number limits, OpenClaw docs if not in Context7, current pricing/limits).

Match the tool to the task:
- `firecrawl_search` — find sources on the web.
- `firecrawl_scrape` — retrieve one known URL as markdown/HTML/JSON.
- `firecrawl_map` — enumerate a site's URLs without fetching content (find the right doc page).
- `firecrawl_crawl` — collect many pages from one site.
- `firecrawl_extract` — structured extraction from one or more URLs with a JSON schema.
- `firecrawl_agent` — multi-source research; read the result with `firecrawl_agent_status` (takes minutes, non-blocking).
- `firecrawl_parse` — parse a local PDF/DOCX/XLSX into markdown (useful for the demo's `return-policy.pdf` / `shipping-policy.pdf` ingestion path).

Prefer Context7 for library docs; reach for Firecrawl when you need the live web or a specific page.

### Skills — invoke when the task fits

Skills are available via the `Skill` tool. Relevant ones for this project:
- **`init`** — (already used to generate this file).
- **`firecrawl`** — install/usage routing for Firecrawl; read it before heavy scraping work.
- **`frontend-design` / `dataviz`** — before building dashboard UI or any chart/visualization. Read **before** writing the first line of UI/chart code.
- **`run`** — launch and drive the app to confirm a change works in the real app (not just tests).
- **`security-review`** — security review of pending changes; use before merging anything touching auth, tools, webhooks, or tenant isolation.
- **`simplify`** — review changed code for reuse/simplification/efficiency and apply fixes (quality, not bug-hunting).
- **`fewer-permission-prompts`** — after a few sessions, scan transcripts and allowlist common read-only Bash/MCP calls in `.claude/settings.json`.
- **`update-config`** — for settings.json/hooks/permissions changes (e.g. "from now on when X, do Y" needs a hook, not memory).
- **`loop`** — recurring task/polling (e.g. "check the deploy every 5 minutes").
- **`claude-api`** — reference for the Claude/Anthropic API; read before working with model IDs, pricing, tool-use, or MCP definitions.

Invoke a skill the moment the task matches — don't reinvent what the skill already encodes.
