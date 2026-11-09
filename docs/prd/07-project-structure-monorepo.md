# 23B. Project Structure & Scaffolding Plan

> Dated note 2026-11-09 (PRD 16 DOC-2): the dashboard ownership statements
> below predate the enterprise split. The Tool Gateway HTTP surface, the Meta
> webhook and media serving moved to `apps/api`; WhatsApp sockets, all
> scheduler ticks and the outbox drain moved to `apps/worker` (PRD 08 and
> its plan). The OpenClaw runtime was replaced by the direct LLM client and
> its env vars do not exist. Everything else here (workspaces, package
> layout, tsconfig paths, the admin/web apps) is accurate.

## 23B.0 Monorepo Escalation (owner decision 2026-11-08)

The repository is being restructured into an npm-workspaces monorepo. Full
plan and phased execution: `docs/plans/2026-11-08-monorepo-migration-plan.md`.
Summary:

-   `apps/dashboard` - the tenant dashboard UI + BFF (session-scoped routes
    only since PRD 08 Phase 6/7).
-   `packages/core` - shared: Prisma schema/migrations/client, lib domain
    logic (inbox, agent loop, campaign engine, system locks), services,
    tool registry, types. Core never imports from an app; apps never
    import each other.
-   `apps/web` - public UI (section 20A), own deployable.
-   `apps/admin` - platform console. PRD: file 13 (admin console); plan:
    `docs/plans/2026-11-08-admin-console-plan.md`. Execution on owner go.
    Billing stays out of scope (file 04).
-   npm workspaces only - no pnpm/turbo/nx until root builds actually
    hurt. Pages Router stays.

The layout in 23B.1 below documents what was built for the MVP and is
kept as the historical pre-monorepo reference; the migration plan
supersedes it for structure.

## 23B.1 Repository Layout (pre-monorepo, historical)

Single Next.js application (Pages Router). One process, one repository, one
deployable. Separation happens at the directory level inside the app.

``` text
csq/
├── prisma/
│   ├── schema.prisma           # all models, tenant_id from day one
│   ├── migrations/             # includes pgvector extension setup
│   └── seed.ts                 # demo tenant: Toko Kopi Nusantara
├── src/
│   ├── pages/
│   │   ├── _app.tsx
│   │   ├── index.tsx           # marketing landing (deferred — section 20A)
│   │   ├── login.tsx
│   │   ├── register.tsx
│   │   ├── dashboard/          # authenticated dashboard (section 15)
│   │   │   ├── index.tsx       # overview
│   │   │   ├── agents/         # agent list, detail, create
│   │   │   ├── data/           # products, imports, source status
│   │   │   ├── knowledge/      # FAQ, policies, documents
│   │   │   ├── memory/
│   │   │   ├── activity/       # audit log
│   │   │   └── settings/       # channels, approvals, source priority
│   │   └── api/                # Tool Gateway + webhooks
│   │       ├── auth/[...nextauth].ts
│   │       ├── tools/          # agent tool endpoints (section 17)
│   │       ├── webhooks/whatsapp.ts
│   │       └── import/         # excel/csv upload, sheets oauth callback
│   ├── components/
│   │   ├── ui/                 # shadcn/ui primitives
│   │   ├── dashboard/          # dashboard-only components
│   │   └── marketing/          # marketing-only components (deferred)
│   ├── lib/                    # server-side shared utilities
│   │   ├── db.ts               # Prisma client singleton
│   │   ├── auth.ts             # NextAuth config + session helpers
│   │   └── permissions.ts      # capability check used by every tool
│   ├── tools/                  # tool definitions + handlers (section 17)
│   │   ├── index.ts            # tool registry
│   │   ├── product.ts
│   │   ├── inventory.ts
│   │   ├── order.ts
│   │   ├── customer.ts
│   │   └── knowledge.ts
│   ├── services/               # external integrations, one module each
│   │   ├── whatsapp.ts
│   │   ├── sheets.ts
│   │   ├── excel.ts
│   │   └── openclaw.ts
│   ├── types/                  # shared TypeScript types + Zod schemas
│   └── styles/globals.css
├── docs/                       # generated docs (plans, audits, research)
├── docker/
│   ├── Dockerfile              # production app image
│   ├── docker-compose.dev.yml  # dev: pgvector Postgres only
│   └── docker-compose.yml      # prod: app + postgres + openclaw gateway
├── .env.example
├── AGENTS.md
├── README.md
└── package.json
```

## 23B.2 Route Model

-   `/` → marketing landing (placeholder until final phase, section 20A)
-   `/login`, `/register` → Auth.js email/password
-   `/dashboard/*` → tenant dashboard, session required
-   `/api/tools/*` → Tool Gateway, agent-facing, permission-checked,
    audited
-   `/api/webhooks/whatsapp` → Meta webhook (GET verify + POST events)
-   `/api/import/*` → Excel/CSV upload and Google Sheets OAuth flow

## 23B.3 Scaffolding Order

Execute in this order. Each step must pass `npm run build` before the
next begins.

1.  `create-next-app` — TypeScript, ESLint, Tailwind, `src/` directory,
    `@/*` import alias, **decline App Router** (it defaults on). Node 20 LTS.
2.  Core dependencies: `prisma`, `@prisma/client`, `zod`, `next-auth`,
    `exceljs`, `googleapis`, `node-cron`.
3.  shadcn/ui init + base components (button, card, input, table, dialog,
    badge, switch).
4.  Prisma init — PostgreSQL provider. First migration enables the
    `vector` extension and creates the initial schema. Create `lib/vector.ts`
    with the standard helper functions (see 23B.6). Seed the demo
    tenant (Toko Kopi Nusantara).
5.  Auth.js credentials provider + User model. Create `withAuth` HOC in
    `lib/auth.ts`. Protect `/dashboard/*` via `getServerSideProps` wrapper
    (no middleware — see 23B.6).
6.  Docker dev database — `pgvector/pgvector:pg16` image via
    `docker-compose.dev.yml` + `.env.example` with all variables.
7.  `git init` + initial commit. Conventional commits from the first
    commit onward.

## 23B.4 Known Technical Constraints

-   **pgvector + Prisma:** Prisma has no native `vector` column type.
    Declare embedding columns as `Unsupported("vector")` in schema.prisma
    and read/write them through raw SQL (`$queryRaw`/`$executeRaw`) in
    `lib/vector.ts` (see 23B.6 convention). The
    `CREATE EXTENSION vector` statement lives in the first migration.
-   **create-next-app defaults to App Router** — it must be explicitly
    declined during scaffolding.
-   **Dev Postgres:** plain `postgres` image lacks pgvector; use the
    `pgvector/pgvector:pg16` image locally and in production.
-   **Validation gates:** `npm run build` + `npm run lint`. No test
    framework initially; add Vitest later only for modules that genuinely
    need unit tests (e.g. permissions.ts).

## 23B.5 Environment Variables

``` text
# Database
DATABASE_URL=

# Auth
NEXTAUTH_URL=
NEXTAUTH_SECRET=

# WhatsApp Cloud API
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=

# Google Sheets
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=

# OpenClaw (TBD — pending integration validation, section 23A)
OPENCLAW_BASE_URL=
OPENCLAW_API_KEY=
```

`.env` is never committed. `.env.example` documents every variable with an
empty value. Secrets stay server-side only — client code never sees them.

## 23B.6 Conventions

-   File naming: kebab-case for pages and components, camelCase for lib
    and service modules.
-   Import alias: `@/*` → `src/*`.
-   Every API route validates its input with Zod before touching Prisma.
-   Every database query filters by `tenant_id` — no exceptions.
-   Component boundaries: `components/dashboard` never imports from
    `components/marketing`, and vice versa.
-   **Vector operations:** All pgvector reads and writes go through a single
    module `lib/vector.ts`. Never raw SQL outside this file. The module
    exposes:
    -   `upsertEmbedding(model, recordId, tenantId, embedding)` — insert or
        replace a vector row via `$executeRaw`.
    -   `findSimilar(model, tenantId, queryEmbedding, options?)` — cosine
        similarity search via `$queryRaw`, returns typed records with a
        `similarity` field. Options: `threshold` (default 0.7), `limit`
        (default 5), `filters` (extra where clauses for agent scope).
    -   `deleteEmbedding(model, recordId, tenantId)` — remove a vector row.
    -   Prisma schema declares the column as `Unsupported("vector")`; the
        actual column type in Postgres is `vector(1536)` (or whatever
        dimension the embedding model requires).
-   **Dashboard auth protection:** Use `getServerSideProps` with a shared
    `withAuth(getServerSideProps)` HOC wrapper. Every page under
    `pages/dashboard/` wraps its `getServerSideProps` (or the page
    component directly for static-ish pages) with `withAuth`. No Next.js
    middleware — it adds complexity for no benefit on a handful of routes.

