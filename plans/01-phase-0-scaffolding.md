# Phase 0 — Scaffolding & Foundation

**Goal:** Create the Next.js project with all dependencies, tooling, and config.
Everything after this phase builds on top of these files.
**PRD Reference:** Section 23B.1–23B.6
**Depends On:** Nothing

---

## Tasks

### 0.1 Create Next.js project

- [ ] Run `npx create-next-app@latest csq` with:
  - TypeScript: Yes
  - ESLint: Yes
  - Tailwind CSS: Yes
  - `src/` directory: Yes
  - Import alias: `@/*`
  - **App Router: NO** (explicitly decline)
- [ ] Move into the project directory. Verify `npm run build` passes.
- [ ] Remove boilerplate content from `src/pages/index.tsx` (placeholder only).

### 0.2 Install core dependencies

- [ ] `npm i @prisma/client next-auth exceljs googleapis node-cron zod`
- [ ] `npm i -D prisma ts-node`
- [ ] Verify `npm run build` still passes.

### 0.3 Configure shadcn/ui

- [ ] Initialize shadcn/ui (`npx shadcn-ui@latest init`).
- [ ] Add base components: `button`, `card`, `input`, `table`, `dialog`,
  `badge`, `switch`, `label`, `select`, `textarea`, `separator`, `dropdown-menu`.
- [ ] Verify `npm run build` still passes.
- [ ] Verify components render in `src/pages/index.tsx` (smoke test — add a
  Button to the placeholder page, build, move on).

### 0.4 Configure environment variables

- [ ] Create `.env.example` with all variables from PRD 23B.5:
  ```
  DATABASE_URL=
  NEXTAUTH_URL=
  NEXTAUTH_SECRET=
  WHATSAPP_TOKEN=
  WHATSAPP_PHONE_NUMBER_ID=
  WHATSAPP_VERIFY_TOKEN=
  GOOGLE_CLIENT_ID=
  GOOGLE_CLIENT_SECRET=
  GOOGLE_REDIRECT_URI=
  OPENCLAW_BASE_URL=
  OPENCLAW_API_KEY=
  ```
- [ ] Create `.env` (gitignored) with dev Postgres connection string.
- [ ] Add `.env` to `.gitignore` (create-next-app should already do this — verify).

### 0.5 Docker dev database

- [ ] Create `docker/docker-compose.dev.yml` with `pgvector/pgvector:pg16`:
  ```yaml
  services:
    postgres:
      image: pgvector/pgvector:pg16
      environment:
        POSTGRES_DB: umkm_dev
        POSTGRES_USER: umkm
        POSTGRES_PASSWORD: umkm_dev_password
      ports:
        - "5432:5432"
      volumes:
        - pgdata:/var/lib/postgresql/data
  volumes:
    pgdata:
  ```
- [ ] `docker compose -f docker/docker-compose.dev.yml up -d` and verify
  Postgres is running on port 5432.
- [ ] `DATABASE_URL=postgresql://umkm:umkm_dev_password@localhost:5432/umkm_dev`

### 0.6 Create directory structure

Create empty directories (and minimal placeholder files where needed) matching
PRD 23B.1 layout:

- [ ] `src/lib/` — placeholder `db.ts` (will be implemented in Phase 1)
- [ ] `src/types/` — placeholder `index.ts` (export empty for now)
- [ ] `src/tools/` — placeholder `index.ts` (empty registry)
- [ ] `src/services/` — empty directory
- [ ] `src/components/dashboard/` — empty directory
- [ ] `src/components/marketing/` — empty directory
- [ ] `src/pages/dashboard/` — placeholder `index.tsx` (will redirect or show "coming soon")
- [ ] `src/pages/api/tools/` — placeholder route
- [ ] `src/pages/api/webhooks/` — placeholder route
- [ ] `src/pages/api/import/` — placeholder route
- [ ] `docs/` — empty directory
- [ ] `docker/` — already has `docker-compose.dev.yml`
- [ ] `prisma/` — will be populated in Phase 1

### 0.7 Git initialization

- [ ] `git init`
- [ ] Create `.gitignore` (verify create-next-app template covers: `node_modules/`,
  `.next/`, `.env`, `*.log`, `prisma/migrations/migration_lock.toml`).
- [ ] Initial commit: `chore: scaffold Next.js project with dependencies`
- [ ] Verify clean `git status`.

---

## Build Gate

- [ ] `npm run build` — zero errors.
- [ ] `npm run lint` — zero errors.
- [ ] `docker compose -f docker/docker-compose.dev.yml up -d` — Postgres running.
- [ ] `git log` shows one clean initial commit.

---

## Files Created/Modified

```
csq/          (entire project)
├── docker/
│   └── docker-compose.dev.yml
├── .env.example
├── .env
├── .gitignore
├── src/
│   ├── components/dashboard/
│   ├── components/marketing/
│   ├── lib/db.ts              (placeholder)
│   ├── pages/
│   │   ├── index.tsx          (clean placeholder)
│   │   ├── dashboard/index.tsx (placeholder)
│   │   ├── api/tools/index.ts (placeholder)
│   │   ├── api/webhooks/whatsapp.ts (placeholder)
│   │   └── api/import/index.ts (placeholder)
│   ├── tools/index.ts         (empty registry)
│   ├── types/index.ts        (empty)
│   └── services/
├── docs/
├── prisma/                    (empty, for Phase 1)
└── package.json
```

---

## Notes

- Do NOT create the Prisma schema here. That's Phase 1.
- Do NOT set up Auth.js here. That's Phase 2.
- This phase is pure scaffolding — project exists, builds, and has the right
  folder structure. Nothing functional yet.
