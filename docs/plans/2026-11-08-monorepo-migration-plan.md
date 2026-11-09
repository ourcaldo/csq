# Monorepo Migration Plan (PRD 23B.0)

Date: 2026-11-08
> Status 2026-11-09 (PRD 16 DOC-5): the "not built / blocked" statements
> for `apps/admin`, `apps/worker` and `packages/ui` in Phases 4-5 are
> historical - all three are built, deployed and consumed. They were
> delivered by the enterprise architecture plan (PRD 08), the admin console
> plan (PRD 13) and the shared UI plan (PRD 12) respectively. UI sharing is
> in, not out of scope. The production cutover notes remain frozen by the
> owner directive.

Owner decision: the product escalates beyond the single-tenant demo app.
Three frontends are planned: the public UI, the tenant dashboard, and later
the platform admin console. This document is the agreed plan; PRD section
23B and section 20 notes were amended to match.

## 1. Why

The current single Next.js app serves the tenant dashboard, the Tool
Gateway, the agent runtime, and the WhatsApp channel sockets in one
deployable. Two problems with the planned escalation:

1. Every frontend change redeploys the whole process - including the
   process holding live WhatsApp sessions. The 2026-11-07/08 incident
   showed exactly what that costs: every deploy overlaps instances, the
   session lease now contains the 440 fight, but the sockets still
   restart and tenant traffic blips on every push.
2. A platform admin console must not share a process, an auth realm, or a
   blast radius with tenant-facing traffic.

## 2. Target layout

```text
csq/
├── package.json                # workspace root: scripts only, no deps
├── package-lock.json
├── apps/
│   ├── web/                    # public UI (PRD 20A) - Phase 3
│   ├── dashboard/              # the existing Next.js app, moved (Phase 1)
│   │   ├── src/                # pages, components, app-only hooks
│   │   ├── .env*               # env files live with the app
│   │   ├── next.config.mjs
│   │   └── package.json
│   └── admin/                  # platform console - Phase 4, needs a PRD
│       └── ...                 #   section first (SaaS-operator scope)
├── packages/
│   └── core/                   # Phase 2: everything apps share
│       ├── prisma/             # schema + migrations + seed
│       ├── src/
│       │   ├── lib/            # db, auth helpers, inbox, agent-loop,
│       │   │                   # campaign-engine, system-lock, whatsapp-*
│       │   ├── services/      # llm-runtime, baileys, scheduler, excel,
│       │   │                   # sheets, whatsapp
│       │   ├── tools/          # tool registry + handlers (PRD 17)
│       │   └── types/          # shared TS types + Zod schemas
│       └── package.json        # name: @csq/core
├── docker/                     # compose files updated to new build ctx
├── scripts/                     # self-checks + encoding guard (paths upd.)
└── docs/
```

## 3. Tooling decisions

- **npm workspaces.** No pnpm, no turborepo, no nx. Rationale: the Render
  build box already runs npm; workspaces need zero new tooling and the
  existing `npm ci` at the root installs everything. Revisit turborepo
  only when root `npm run build` hurts (3+ apps).
- **Pages Router stays.** No App Router migration is part of this plan.
- **One database, one schema.** Prisma lives in packages/core; apps never
  declare their own Prisma dependency, they import the client through
  `@csq/core/lib/db`.
- **Dependency direction (hard rule):** packages/core must never import
  from any app. Apps may import core and their own code. Apps never
  import each other.
- **UI code stays per-app.** components/, hooks, styles are app-local.
  Extract packages/ui only when the same component is copy-pasted into a
  third app (repo rule: extract on the third occurrence).
- **Only apps/dashboard owns WhatsApp channels.** apps/web and apps/admin
  must never create a Baileys socket. The SystemLock lease key stays
  channel-scoped, so a future split of the channel process is a Phase 5
  move, not a redesign.

## 4. Phases

Each phase is one or more commits, must pass `npm run build`,
`npm run check:encoding`, and the self-check scripts before it is
committed, and must leave production deployable at every step.

### Phase 1 - Workspace skeleton (app moved, no extraction)

1. Root package.json becomes the workspace manifest:
   `"workspaces": ["apps/*", "packages/*"]` plus proxy scripts
   (build/start/db:generate/db:deploy) delegating to workspaces.
2. `git mv` the existing app into `apps/dashboard/` unchanged
   (src, public, config files, .env files, package.json deps move with it;
   git mv preserves history).
3. Root package.json keeps the `"prisma": { "schema":
   "apps/dashboard/prisma/schema.prisma" }` key so the CURRENT Render
   build command keeps working during Phase 1 (no Render change needed
   yet).
4. Update path references: scripts/check-encoding.mjs scan list,
   scripts/self-check-*.ts relative imports, docker/ build contexts,
   .dockerignore, README quickstart paths.
5. Deploy pipeline cutover (one-time, done together with the Phase 1
   push):
   - Render Build Command: `npm ci && npm run build`
   - Render Start Command: `npm run start`
   - Root scripts:
     - `build` = `prisma generate && npm run build -w apps/dashboard`
     - `start` = `npm run db:deploy -w apps/dashboard && npm run start -w apps/dashboard`
     - (per-app `start` = `npx prisma migrate deploy && npx next start`
       until Phase 2 moves prisma into core)
6. Acceptance: production deploy from the new layout boots, the Baileys
   channel reconnects via the session lease, dashboard + inbox work, a
   WhatsApp send delivers.

### Phase 2 - Extract packages/core

1. `git mv` prisma/, src/lib, src/services, src/tools, src/types into
   packages/core (src/lib keeps only app-browser code if any, e.g.
   api-client stays in the app until apps/web needs it).
2. packages/core package.json: name `@csq/core`, main/exports map,
   dependencies it truly needs (prisma, zod, baileys, googleapis,
   exceljs, node-cron, next-auth for the auth helpers).
3. Mechanical import rewrite in apps/dashboard: `@/lib/x` ->
   `@csq/core/lib/x`, `@/services/x` -> `@csq/core/services/x`,
   `@/tools/x` -> `@csq/core/tools/x`, `@/types/x` ->
   `@csq/core/types/x`. Pages/components imports of UI code stay `@/`.
4. Root `"prisma.schema"` key now points at `packages/core/prisma/schema.prisma`.
5. tsconfig per package: core compiled via the app's Next build for now
   (no separate tsc build step - YAGNI); `transpilePackages` in
   next.config if needed.
6. Acceptance: same as Phase 1 plus self-checks pass from the new paths.

### Phase 3 - apps/web (public UI, PRD 20A)

1. Scaffold apps/web as its own Next.js Pages Router app.
2. Static/minimally dynamic marketing pages per PRD 20A; may import
   `@csq/core/types` only. No Prisma, no channels, no tenant data.
3. Render: second web service pointed at the same repo with a root
   directory / filtered build (`npm run build -w apps/web`), or a static
   export - decide when the content is real.
4. Acceptance: public site deployable and the dashboard deploy is
   untouched by it.

### Phase 4 - apps/admin (platform console)

Blocked on product work, not structure: requires a new PRD section
defining SaaS-operator scope (tenant provisioning, plans, monitoring)
and its own auth realm. The current MVP out-of-scope list (PRD 20) still
applies until that section exists. Structurally: same recipe as Phase 3
plus an admin auth design (separate NextAuth instance, separate user
table or a role realm - to be decided in that PRD section).

### Phase 5 (optional, later) - channel worker service

Move the Baileys scheduler + sockets into a dedicated service so
dashboard/web/admin deploys never restart tenant WhatsApp sessions.
The SystemLock lease makes this a lift-and-shift of
services/baileys.ts + scheduler into a small worker, not a redesign.
Trigger: deploys disturbing live sessions becomes a recurring business
complaint.

## 5. Risks and mitigations

- **Deploy cutover breaks production.** Mitigation: Phase 1 is designed so
  the OLD Render commands keep working (root prisma.schema key + proxy
  scripts); the new commands are pasted into Render at the same push.
  Rollback: revert the commit and the Render commands - the old layout
  returns via git.
- **Instance overlap during the Phase 1 deploy churns the WhatsApp
  session again.** Mitigation: already shipped - the SystemLock session
  lease makes the draining instance keep the session and the new instance
  stand down.
- **Import rewrite misses files.** Mitigation: TypeScript build gate -
  any missed import fails `npm run build`; no runtime-only risk.
- **Prisma client generated in the wrong place.** Mitigation: root
  `prisma.schema` key + Phase 2 acceptance includes a production deploy.
- **Env files.** `.env*` files move with apps/dashboard; Render injects
  env at the process level and is unaffected.
- **History noise.** git mv per file tree keeps renames detectable.

## 6. Explicitly out of this plan

- App Router migration, pnpm/turbo/nx, splitting the database, a shared
  UI package before a third duplicate exists, apps/admin implementation
  before its PRD section, and any channel-service split before Phase 5's
  trigger fires.
