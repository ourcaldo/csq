# Changelogs

Version format: `XX.YY.ZZ` — YY (minor) and ZZ (patch) stay within 0–10; XX (major) may grow beyond. Minor = new feature/behavior change, patch = fix, major = breaking change (schema, API contract, env vars).

## 1.4.0 — 2026-10-26

Customer lifecycle timeline (Riwayat) in the inbox contact panel.

- **Added:** `GET /api/dashboard/inbox/conversations/[id]/history` — merges first-chat, orders (by customer phone), and pipeline stage moves (with AI vs human attribution) into one bounded, newest-first timeline; stage/user names resolved in batched lookups, not per-row.
- **Added:** Riwayat section in the contact-details panel (desktop pane + mobile drawer): per-event icon, text, short id-ID date. Empty state shown when only the first-chat anchor exists.

## 1.3.0 — 2026-10-25

Provider-neutral LLM config.

- **Changed:** `LLM_EMBEDDING_MODEL` no longer has a provider-specific default — it must be set explicitly; unset = embeddings unconfigured (knowledge.search degrades to keyword search). All Fireworks references removed from code defaults, compose, env examples, README.

## 1.2.10 — 2026-10-25

Decision record: multi-agent discussion documented.

- **Added:** `docs/2026-10-25-project-discussion.md` — first project-discussion record: multi-agent capability stays, single-CS-agent focus, owner-ops agent deferred to phase 2 with security prerequisites (owner-phone allowlist + confirmation loop for writes). File also documents the purpose + update convention for `*-project-discussion.md` files.

## 1.2.9 — 2026-10-25

Project descriptions updated: HackFest framing removed — the project is now described as an active product, not a hackathon entry.

- **Changed:** README and package.json descriptions drop the "HackFest MVP" framing.
- **Changed:** CLAUDE.md / AGENTS.md project-status sections rewritten for the current state (scaffolding landed, direct LLM runtime, OpenClaw gone).
- **Added:** This changelog (`Changelogs.md`), backfilled from commit history.
- **Added:** Version discipline — `package.json` version now tracked (started at 1.2.8 to match the OpenClaw removal release).

## 1.2.8 — 2026-10-25

Direct OpenAI-compatible agent runtime; OpenClaw removed.

- **Removed:** OpenClaw sidecar — per-tenant cells, fleet provisioning, docker-socket mount, `x-openclaw-api-key` tool auth, reprovision endpoint, OpenClaw settings card (`d7ac2bb`, `3e38e3c`).
- **Changed:** Agent loop (`src/services/llm-runtime.ts`) drives any OpenAI-compatible provider directly via `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_CHAT_MODEL` — one provider serves agent chat, scenario AI, and embeddings (provider-agnostic: Fireworks, OpenAI, Groq, OpenRouter, local vLLM).
- **Changed:** Session context replaced by bounded replay of the last 20 messages within the 1h window from our own Message rows; internal notes excluded.
- **Changed:** Deploying an agent is a pure status flip (DRAFT → ACTIVE) — no external provisioning.
- **Removed (db):** `openclaw*` + `cellStatus` columns from Tenant/Agent/Conversation (migration `20261025000000_remove_openclaw_cells`).
- **Fixed:** BOM byte stripped from the removal migration (`3e38e3c`).

## 0.10.7 — 2026-09-24

Message template manager + inbox polish.

- **Added:** Message template manager (dashboard UI + API) with kind-driven form fields, guided key dropdown, unique keys (`ce6a9ea`, `4573a9d`).
- **Added:** Automatic session-close message on 1h idle.
- **Added:** WhatsApp-style unread badges on the conversation list (`67162f7`).
- **Added:** Session-based agent context with 1h TTL, `order.list` tool, WhatsApp message formatting (`ceb8363`).
- **Added:** Tone rules, human order numbers, pre-line chat layout, read ticks + typing indicator (`c50bec0`).
- **Added:** Server-generated verify token, rotated on disconnect; webhook setup box promoted in Saluran step 2 (`89be0fa`, `ed8a5c1`, `bf5f18b`).
- **Added:** Bounded in-memory diagnostics for rejected inbound webhook POSTs (`ad088ed`).
- **Fixed:** Emoji whitelist + scope guard against off-topic prompt injection (`15a0e5e`).
- **Fixed:** Live conversation list + full refetch on SSE reconnect (`877bef1`).
- **Fixed:** Legacy demo verify-token treated as weak — backfilled with a real token (`77fd187`).

## 0.9.6 — 2026-09-23

Channel UX hardening (continuation of 0.9.5 rollout).

- **Added:** Webhook URL + verify token shown on the connected channel card (`ceed349`).
- **Fixed:** Baileys downgraded 7.0.0-rc14 → 6.7.24 — the rc line failed before QR (`0a14d73`).
- **Docs:** End-to-end flow diagrams consolidated into one user-level image (`95c217b`, `44c7ae2`); marketing video script (`c7151a5`).

## 0.8.5 — 2026-09-19

Provider swap (later reverted in 1.2.8) + docs.

- **Changed (later reverted):** Fireworks → Cloudflare Workers AI for embeddings, scenario AI, agent model (`8c72e90`).

## 0.7.4 — 2026-09-01

Scenario engine expansion.

- **Added:** Scenario `ai`, `setStage`, `assign`, `email` modules for the visual builder (`9eb3740`).
- **Added:** ON_SCHEDULE + ON_NO_REPLY triggers, stage dropdown on setStage (`4fae4ce`).
- **Added:** Per-tenant email integration — SMTP or Resend (`fab2174`).

## 0.6.3 — 2026-08-25

Landing page spec-driven redesign.

- **Added:** Hero video, triptych, cost calculator with free add-ons, FAQ/CTA/footer (`6cff051`, `0d39d40`).
- **Added:** ChatCircleDots logo mark (`6cf8a3f`).
- **Fixed:** Mobile stacking/overflow across landing sections (`842f057`, `1454eaa`, `7d23c0e`).

## 0.5.2 — 2026-08-24

Landing iteration (multiple hero/layout passes, `f429207` → `2514a68`).

- **Added:** Hero background video, kinetic-typography hero, bento layout, scrub principles (`e38e92e`, `d7bef3a`, `a2bd4e2`).
- **Fixed:** Hero height/spacing responsiveness; z-index and alignment nits.

## 0.4.1 — 2026-08-23

Inbox/tags/pipeline polish.

- **Added:** Tag colors, collapsible conversation details pane, pipeline card popup (`503fc60`).
- **Added:** Per-page SEO titles + marketing landing page (`0f18f7d`).

## 0.3.0 — 2026-08-22

Visual automation builder + pipeline + big hardening pass.

- **Added:** Visual drag-and-drop scenario builder (`18bdfa2`, `8b802ce`, `1121511`, `c2908ea`).
- **Added:** Deal-stage pipeline — kanban, funnel, stage settings, AI auto-move (`d6f2173`).
- **Added:** Type-aware data sources — agent knows WHAT each source is (`10878f8`, `6c2515c`).
- **Added:** Excel upload + Google Sheets connect/disconnect, multi-spreadsheet (`207d899`).
- **Added:** Human handoff + customer identity capture (name/email) (`d22231f`).
- **Fixed:** Security pass — OWNER role gates, tenant filters, honest RLS docs, type safety (`4a0be52`).
- **Fixed:** Ingestion — Excel source priority, atomicity, row cap, SKU unique (`e2236e0`).
- **Fixed:** Agent — tool-call JSON.parse guard, handoff history, test-chat lock (`c97a8b3`).
- **Fixed:** Deploy — container limits, build-in-CI, .dockerignore (`a0ea0bf`).

## 0.2.0 — 2026-08-21

Agent flow gaps closed + inbox tag/template UX.

- **Added:** All remaining agent-flow gaps closed (G1, G2, G4–G10) (`114521e`).
- **Added:** `source.search` tool + Sync Sekarang (`6c2515c`).
- **Fixed:** Sheets sync — real error surfaced, config validated, ERROR sources auto-retry on redeploy (`a080b5e`, `c6857b5`).
- **Fixed:** Inbox tag picker clipping, filters, template send (`019454d`).

## 0.1.1 — 2026-08-20

Knowledge retrieval + Baileys stability.

- **Added:** On-demand pgvector semantic retrieval via embeddings (`b9b91d1`).
- **Added:** Real phone number resolution (WhatsApp LID → PN) (`d8e7dd1`).
- **Fixed:** Baileys — creds stored in Postgres (no re-pair on restart), full remoteJid, text extraction, keepalive/heartbeat (`af235b3`, `d6550c9`, `dc85bfe`, `d2b9323`).
- **Fixed:** Agent skips disconnected channels; Putuskan actually disconnects (`fad63ec`, `8cab3a8`).

## 0.1.0 — 2026-08-17 → 2026-08-19

Initial MVP — phases 0–10.

- **Added:** Full scaffolding through CRM inbox + agent runtime (`0230704`), dashboard shell + all pages (`978a7b0`), Saluran wizard + Baileys/Cloud API channels (`273d307`, `36235e7`), multi-agent creation with per-tenant runtime cells (`3b961c1`), production Docker/VPS stack (`5bede51`), demo seed (Toko Kopi Nusantara).
- **Fixed:** Webhook fail-closed, RLS policies, auth hardening, ingestion validation (batch A–K, `44b2fcf` → `2a3edd9`).
