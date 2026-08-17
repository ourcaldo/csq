# Master Implementation Plan

**Project:** UMKM Agent Workspace (HackFest MVP)
**Date:** 2026-08-16
**Status:** Planning
**PRD:** `../docs/prd-product-requirements-document.md`

---

## Overview

Build a self-hosted, multi-tenant AI agent platform for Indonesian UMKM. The MVP
delivers a single Customer Service Agent on WhatsApp that reads and writes
business data (manual, Excel/CSV, Google Sheets) under strictly controlled
permissions.

This is a single Next.js app (Pages Router) with PostgreSQL + Prisma + pgvector.
One process serves dashboard UI and Tool Gateway API routes. No monorepo, no
separate backend service.

---

## Phases

| Phase | Focus | PRD Sections | Depends On |
|-------|-------|--------------|------------|
| [0](./01-phase-0-scaffolding.md) | Scaffolding & Foundation | 23B.1–23B.6 | — |
| [1](./02-phase-1-data-layer.md) | Data Layer (Prisma, Schema, Vector) | 7, 23A, 23B.4 | 0 |
| [2](./03-phase-2-auth-tenant.md) | Auth & Tenant Isolation | 5, 18, 23A | 0, 1 |
| [3](./04-phase-3-business-data.md) | Business Data CRUD + Knowledge + Memory | 7, 8.1, 15.3–15.5 | 1, 2 |
| [4](./05-phase-4-data-ingestion.md) | Data Ingestion (Excel/CSV, Google Sheets) | 8.2, 8.3 | 1, 3 |
| [5](./06-phase-5-tool-gateway.md) | Tool Gateway (Registry, Permissions, Audit) | 9, 10, 11, 12, 17, 27 | 1, 2, 3 |
| [6](./07-phase-6-openclaw-integration.md) | OpenClaw Integration (Agent Runtime, Cells) | 4.3, 23A, 26 | 5 |
| [7](./08-phase-7-whatsapp-channel.md) | WhatsApp Channel (Webhook, Cloud API) | 4.4, 14, 23A | 5, 6 |
| [8](./09-phase-8-dashboard-ui.md) | Dashboard UI (All Pages) | 15, 16 | 1, 2, 3, 4 |
| [9](./10-phase-9-demo-marketing.md) | Demo Prep & Marketing Pages | 20A, 21, 22 | All above |
| [10](./11-phase-10-deployment.md) | Deployment (Docker, Nginx, TLS) | 22A, 23A, 23B.3 | All above |

---

## Critical Path

The critical path for a working end-to-end demo is:

```
Phase 0 → 1 → 2 → 5 → 6 → 7 → 10
              ↘ 3 → 4 → 8 ↗
                       ↘ 9
```

**Phase 5 (Tool Gateway) is the bottleneck.** Nothing talks to the agent
without it. Phases 3, 4, and 8 can run in parallel with 5, 6, 7 as long
as 5 lands before 6.

### Parallelization Opportunities

```
After Phase 2 completes, these can run concurrently:
  - Track A: Phase 5 → 6 → 7 (agent backbone)
  - Track B: Phase 3 → 4 (business data)
  - Track C: Phase 8  (dashboard UI — reads from same Prisma models)
```

---

## Open Risks

| Risk | Impact | Mitigation | Status |
|------|--------|------------|--------|
| OpenClaw integration method unknown | Could change backend layout or require separate process | Validate against docs early (Phase 6). Fall back to HTTP tool-calling pattern. | **Unresolved** |
| OpenClaw resource footprint on 4GB RAM | Might not fit alongside Next.js + Postgres | Test early. If it doesn't fit, consider running OpenClaw on a separate lightweight container. | **Unresolved** |
| pgvector + Prisma raw SQL patterns | Potential for inconsistent vector operations | Locked convention in 23B.6 — all through `lib/vector.ts`. | Mitigated |
| WhatsApp Cloud API test number limits | Rate limits or availability issues for demo | Prepare Baileys as documented fallback, but do NOT default to it. | Documented |
| Embedding model choice not specified | Vector dimension depends on model | Decide in Phase 1. OpenAI `text-embedding-3-small` (1536 dim) is the safe default. | **Unresolved** |
| One-month build window | Tight for the full scope | Strict phase ordering, build gates, no gold-plating. Phase 9 (marketing) is explicitly deferred. | Acknowledged |

---

## Conventions for All Phases

- Every phase ends with `npm run build` passing.
- Every new file follows naming conventions in PRD 23B.6.
- Every new Prisma model includes `tenant_id`.
- Every new API route validates input with Zod.
- Every new tool is registered in `tools/index.ts` and permission-checked via `lib/permissions.ts`.
- Git commit after each phase's build gate passes. Conventional commits.

---

## Phase Completion Checklist

A phase is **complete** when:

1. All tasks in the phase file are checked off.
2. `npm run build` passes with zero errors.
3. `npm run lint` passes (once ESLint is configured in Phase 0).
4. New code doesn't break existing phases.
5. Git commit with conventional message.
