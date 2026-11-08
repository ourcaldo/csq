# CSQ — Current Status, Gaps, and Next Steps

**Date:** 2026-08-19
**Live app:** https://csq-z821.onrender.com
**Repo:** https://github.com/ourcaldo/csq (`main`, currently public)
**Deploy:** Render web service `csq` (`srv-da2benou01pc73b25e90`, standard plan, Singapore, Node runtime)
**Database:** Neon Postgres (`winter-flower-03790042`, ap-southeast-1) — pgvector-enabled, all migrations applied, demo tenant seeded

---

## 1. Current situation — what's already done

### Codebase (phases 0–10)
All 11 phases of the master plan are implemented and on `main`:
- **Phase 0** scaffolding (Next.js Pages Router, TS, Tailwind, shadcn/ui, Prisma, Docker dev/prod)
- **Phase 1** data layer (17+ models with `tenant_id`, pgvector via `lib/vector.ts`, seed)
- **Phase 2** auth (NextAuth + `withAuth` HOC, no middleware, `requireRole`)
- **Phase 3** business CRUD (products/inventory/orders/contacts/tags/knowledge/memory/sources)
- **Phase 4** ingestion (Excel/CSV + Google Sheets OAuth, node-cron sync)
- **Phase 5** Tool Gateway (registry, permissions, audit, Zod-validated, tenant/agent-scoped)
- **Phase 6** OpenClaw integration (sidecar client, agent loop, deploy/pause, chat route)
- **Phase 7** WhatsApp (Cloud API + Baileys pluggable, webhook, inbox backend, channels API)
- **Phase 8** dashboard UI (shell, all pages, CRM inbox)
- **Phase 9** demo prep (seeded agent + capabilities + channel, demo xlsx, `demo:reset`)
- **Phase 10** deployment (Dockerfile, Compose, Nginx, Certbot, VPS script)

### Verification (report `2026-08-17-phases-0-10-verification.md`)
Every non-UI verification issue is fixed and pushed (batches A–I): the 3 Criticals (webhook fail-closed, `tenant_id` on junction tables, RLS migration), all 6 High non-UI gaps (channels API, Baileys wiring, demo seed), and every Medium non-UI item. Build + lint green throughout. The sacred demo safety moment (agent refuses unauthorized price change) is intact at the Tool Gateway + prompt layers.

### UI (reskinned to the reference design)
- Login + signup reskinned (split-screen auth shell, Inter, green brand)
- Dashboard shell: white sidebar with grouped Phosphor nav + search/action header + avatar menu
- CRM Inbox (flagship): 3-pane shared inbox (conversation list + chat panel with AI/human/customer bubbles, private notes, quick replies, SSE live updates + contact details with tags + human/AI handoff + status), mobile-responsive (list/chat swap with back button)
- All pages: Overview (StatCards + recent conversations + pending approvals), Products, Inventory, Orders (with No. Pesanan), Contacts, Tags, Knowledge (inline CRUD), Memory, Sources, Agents (capability toggles + deploy/pause), Approvals, Activity, Settings, Team
- Missing shadcn primitives added (Switch, Separator, StatCard, EmptyState, LoadingSkeleton, BadgeStatus)

### Live deploy
- Render web service builds from `main` (`npm ci && npx prisma generate && npm run build`), starts with `npx prisma migrate deploy && npm start`
- `GET /api/health` → `{"status":"ok","db":"up"}` ✅
- Neon Postgres wired (`DATABASE_URL` pooler + `DATABASE_URL_UNPOOLED` direct for migrations); all 3 migrations applied (init, tenant_id junctions, RLS)
- Demo tenant seeded: **Toko Kopi Nusantara**, owner `admin@tokokopi.id` / `demo1234`, 3 products, knowledge, an ACTIVE agent with capabilities, a DISCONNECTED WhatsApp channel
- Auto-deploy on push is on; the latest commit (`a5ff00c`) is live

### Recent fixes on this deploy
- RLS migration corrected (`"tenantId"` not `tenant_id`) — applied to Neon
- Sources priority GET 500 fixed (resilient to legacy `"MEMORY"` entry in stored settings; seed corrected)
- Inbox mobile responsiveness; Orders No. Pesanan column

---

## 2. Gaps

### A. OpenClaw is not running (blocks the end-to-end agent demo)
The Next.js app calls the OpenClaw Gateway over HTTP (`OPENCLAW_BASE_URL`, default `http://127.0.0.1:18789`) for `/v1/chat/completions`. On the Render Node-runtime deploy, **no OpenClaw process is running** — the OpenClaw sidecar is an opt-in Docker container in the project's Compose file, and the Render MCP can only create Node-runtime services, not Docker/image ones. So today the dashboard, inbox, products, approvals, etc. all work, but **the agent auto-reply loop will not actually run** (`runAgentReply` requires `agent.openclawAgentId` + an reachable OpenClaw Gateway).

### B. Channels / WhatsApp onboarding UI is not built
The backend exists (`POST /api/dashboard/channels/{connect,disconnect,test}` with `tosAcknowledged` enforcement for Baileys), but **there is no dashboard page to drive it** — the sidebar has no "Saluran"/"WhatsApp" entry. So an owner cannot connect a real WhatsApp number (Cloud API creds or Baileys QR) from the UI today. This is the missing step between "inbox shows conversations" and "a real WhatsApp number is wired."

### C. Agent instructions/persona editing not wired
The Agents page shows the agent's instructions and toggles capabilities + deploy/pause, but there is **no route/UI to edit the agent's name or instructions** (persona). `provisionAgent` only writes `openclawAgentId`/`openclawCellId`. Editing the persona is a small missing CRUD route + dialog.

### D. Nothing has been run end-to-end live
All verification so far is inspection + `build`/`lint` + the `/api/health` probe. **No real WhatsApp message has flowed through the agent to a reply.** That only becomes possible after A + B.

### E. Deferred / by-design
- **Phase 9 Part B marketing/landing pages** (`/`, `/features`, `/how-it-works`, `/getting-started`) — explicitly allowed to defer by the plan; landing page is a placeholder redirecting to `/dashboard`. To be built last.
- **Separate `/[id]` detail pages** — replaced by inline edit dialogs on list pages (a deliberate MVP pattern; functionally complete).
- **Repo is public** — was required for Render to pull it. Can be set back to private after connecting GitHub to Render in the dashboard.

### F. LLM provider key
OpenClaw (whatever the deploy method) needs an **OpenAI or Anthropic API key** to run completions. That's expected for any agent runtime and is an external secret to provide.

---

## 3. What we need to install / deploy OpenClaw

### Recommended: bare OpenClaw on Render (HackFest-compliant — "OpenClaw only")
Use the official Render guide: **https://render.com/docs/deploy-openclaw** — a `render.yaml` blueprint that deploys OpenClaw as a **Docker web service** (plan `pro`, `healthCheckPath: /health`). Nothing extra layered on (the AlphaClaw wrapper and the GBrain template are *not* used — GBrain duplicates CSQ's own pgvector knowledge layer and would add cost + an extra Anthropic key).

Steps:
1. In the Render dashboard, deploy OpenClaw from the blueprint (or the `render-examples/openclaw-gbrain` repo's `render.yaml`, but **without** the GBrain extras if avoidable — the bare OpenClaw path in the doc is the strict one). Pick the **Singapore** region (same as CSQ + Neon) and a **Pro** plan (OpenClaw's ~400–900MB RAM needs headroom; the 4GB master-plan budget).
2. Provide an **LLM provider key** (OpenAI or Anthropic) to the OpenClaw service as an env var.
3. Once live, note the OpenClaw service URL and its generated **`OPENCLAW_GATEWAY_TOKEN`**.
4. I (via the Render MCP) update CSQ's env vars:
   - `OPENCLAW_BASE_URL` → the OpenClaw service URL (with the correct gateway path — see the routing note below)
   - `OPENCLAW_API_KEY` → the `OPENCLAW_GATEWAY_TOKEN`
   then redeploy CSQ.
5. **Routing nuance to confirm at that point:** AlphaClaw/bare-OpenClaw-on-Render exposes an Express proxy on port 3000 publicly and proxies to the Gateway on 18789 internally. CSQ calls `${OPENCLAW_BASE_URL}/v1/chat/completions`. We need the public URL to forward `/v1/chat/completions` to the gateway (the proxy routes `/api/* (gateway)` and `/openclaw/*` → 18789). If the path doesn't match, either point `OPENCLAW_BASE_URL` at the right prefixed path or expose the gateway port directly. Easy to resolve once the live OpenClaw URL is known.

### Why the MCP can't do the OpenClaw deploy itself
The Render MCP `create_web_service` only deploys **from a Git source repo** (build + start commands). OpenClaw is distributed as a **container image** (`ghcr.io/openclaw/openclaw:slim`) / a `render.yaml` blueprint, and the MCP has no "deploy from image/registry" or "instantiate template" parameter. So the OpenClaw service is created from the **Render dashboard** (one-click / blueprint), not from here. The CSQ-side env wiring afterward **is** something I can do via MCP.

---

## 4. What we should do next (recommended order)

1. **Build the Channels/WhatsApp page** (gap B) — a new `/dashboard/saluran` page: choose Cloud API (enter creds) or Baileys (acknowledge ToS → scan QR), connect/disconnect/test, plus a "Saluran" nav item. Wires entirely to the existing channels backend (only needs a small GET-list route added). This is the last UI piece for a real WhatsApp demo.
2. **Deploy bare OpenClaw on Render** (gap A + F) via `render.com/docs/deploy-openclaw`; provide an LLM key; paste me the URL + `OPENCLAW_GATEWAY_TOKEN`.
3. **Wire CSQ → OpenClaw** — I set `OPENCLAW_BASE_URL` + `OPENCLAW_API_KEY` on the CSQ service and redeploy; confirm the gateway path.
4. **Connect a real WhatsApp number** (gap B done) — Cloud API test number (ToS-safe) or Baileys bring-your-own-number; set the Meta webhook to `https://csq-z821.onrender.com/api/webhooks/whatsapp` with verify token `demo-verify-token`.
5. **Run the end-to-end demo** (gap D): inbound WhatsApp → webhook → ingest → `runAgentReply` → OpenClaw → tool call via Tool Gateway → reply. Verify the **safety moment** (customer asks for an unauthorized price change → agent refuses / creates an approval).
6. **Add agent instructions editing** (gap C) — small `PUT /api/dashboard/agents/[id]` route + dialog on the Agents page so the persona is editable from the dashboard.
7. **(Last) Marketing landing page** (gap E) — build the real front page when the demo is solid.
8. **Repo visibility** — connect GitHub to Render in the dashboard, then set `ourcaldo/csq` back to private if desired.

### Smallest path to a demoable end-to-end this week
Steps 1 + 2 + 3 + 4 + 5. Steps 6–8 are polish/optional. The single highest-leverage item is **2 (deploy OpenClaw)** because it's the only thing standing between the current "dashboard works, agent doesn't reply" state and a full live agent demo.

---

## 5. Credentials & access cheat sheet

| Thing | Value |
|---|---|
| App URL | https://csq-z821.onrender.com |
| Owner login | `admin@tokokopi.id` / `demo1234` |
| Health | `GET /api/health` |
| WhatsApp webhook (to set in Meta) | `https://csq-z821.onrender.com/api/webhooks/whatsapp` |
| Webhook verify token (demo) | `demo-verify-token` |
| OpenClaw base URL (to set after OpenClaw deploy) | `OPENCLAW_BASE_URL` env on CSQ |
| OpenClaw gateway token (to set) | `OPENCLAW_API_KEY` env on CSQ |
