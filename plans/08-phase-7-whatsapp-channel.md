# Phase 7 — WhatsApp Channel + Inbox Backend (Pluggable: Cloud API + Baileys)

**Goal:** Connect the platform to WhatsApp via **two pluggable providers**
(Cloud API official + Baileys bring-your-own-number), and build the **inbox/CRM
backend** — conversation lifecycle, message history, assignment, tags,
human/AI handoff, and contacts. This completes the end-to-end flow:
customer → WhatsApp → inbox/agent → response → WhatsApp, and gives human staff
a shared inbox alongside the AI.
**PRD Reference:** Sections 4.4, 14, 15.8 (Inbox/CRM), 23A (WhatsApp)
**Depends On:** Phase 5, Phase 6 (OpenClaw). Uses Phase 1 models
(Conversation, Message, Contact, Tag, Channel.provider).

---

## ⚠️ Provider Choice & Risk

WhatsApp is **pluggable**. The owner chooses at onboarding (UC-13):

- **Cloud API (official):** ToS-safe; free test number for the demo; free-form
  replies within the 24h customer-service window; templates for proactive
  outbound.
- **Baileys (bring your own number):** QR/pair-code login, full parity, no
  templates/fees. **ToS/ban risk** — UI MUST warn the owner; demo on a
  throwaway test SIM (SDD §7.6).

Both providers implement one common interface, so the inbox, OpenClaw agent,
and Tool Gateway are identical regardless of provider. **Both connectors are
built in this phase, in parallel.**

---

## Tasks

### 7.1 WhatsApp provider interface

- [ ] Create `src/services/whatsapp/provider.ts` — common `WhatsAppProvider`
  interface (SDD §4.8):
  - `start(channel)`, `stop(channelId)`, `sendText(channel, to, text)`,
    `markAsRead(channel, messageId)`, `onMessage(handler)`.
  - `InboundMessage` type: `{ channelId, tenantId, from, body, waMessageId, receivedAt }`.
- [ ] Create `src/services/whatsapp/index.ts` — `getProvider(channel)` returns
  the Cloud or Baileys impl based on `channel.provider`; `sendText` /
  `markAsRead` dispatch to the active provider.

### 7.2 Cloud API provider

- [ ] Create `src/services/whatsapp-cloud.ts` implementing `WhatsAppProvider`:
  - Inbound: Meta POSTs to `/api/webhooks/whatsapp` (GET verify + POST events),
    Zod-validated (reuse `src/types/whatsapp.ts` schemas). Handler calls the
    shared ingest path (7.4).
  - Outbound: `POST https://graph.facebook.com/v18.0/{phoneNumberId}/messages`
    with `WHATSAPP_TOKEN` bearer. Enforce the 24h window: free-form text only
    within 24h of the customer's last inbound; outside the window, require an
    approved template (FR-MS-003).
  - Stateless — no persistent connection. Config in `Channel.config`.

### 7.3 Baileys provider

- [ ] Create `src/services/whatsapp-baileys.ts` implementing `WhatsAppProvider`
  using `@whiskeysockets/baileys` (pure, **no Puppeteer** — light RAM):
  - Runs as a **module-level singleton in the long-lived Next.js process**
    (Docker Compose `node server.js`); one socket per active Baileys channel.
  - Auth via QR code or pairing code (like WhatsApp Web). Auth/session keys
    persisted in Postgres keyed by channel (survive restarts).
  - Inbound: socket events → shared ingest path (7.4). No public webhook
    needed for inbound (works behind NAT).
  - Outbound: full parity, no template/window restriction (FR-MS-004).
- [ ] Add `@whiskeysockets/baileys` dependency.

### 7.4 Shared inbound ingest path

- [ ] Create `src/services/whatsapp/ingest.ts` — `ingestInboundMessage(msg)`:
  1. Upsert `Contact` (tenantId, phone).
  2. Find or create `Conversation` (unique on tenantId+channelId+customerPhone);
     set `contactId`.
  3. Persist inbound `Message` (direction=INBOUND, senderType=CUSTOMER).
  4. Update `Conversation.lastMessageAt`.
  5. **Assignment check:** if `assigneeUserId` set (human) → do NOT dispatch to
     AI; stream to inbox via SSE. If `assignedAgentId` set → invoke that agent.
     If neither → fall back to the channel's default ACTIVE agent; if none,
     reply "Agent sedang tidak aktif".
  6. If AI: forward to `POST /api/agents/[agentId]/chat` (Phase 6).
- [ ] Both Cloud API webhook and Baileys socket call this same path.

### 7.5 Onboarding — provider choice

- [ ] Update channel config API (`src/pages/api/dashboard/channels/`):
  - `connect.ts` — accepts `provider` (CLOUD_API | BAILEYS) + provider-specific
    config. For BAILEYS, return a QR/pair-code challenge; **require a
    `tosAcknowledged` flag** (FR-WA-011) before enabling.
  - `disconnect.ts`, `test.ts` — work for both providers.
- [ ] Dashboard onboarding UI (Phase 8 renders): "Connect official (Cloud API)"
  vs "Link my number (Baileys)" with a ToS/ban-risk warning for Baileys.

### 7.6 Inbox backend

- [ ] Create `src/lib/inbox.ts` (SDD §4.9):
  - `ingestInboundMessage` (shared path, 7.4).
  - `sendHumanReply(conversationId, userId, text)` — persist outbound Message
    (senderType=HUMAN, senderUserId), send via `getProvider(channel).sendText`,
    update `lastMessageAt`.
  - `assignConversation(conversationId, { agentId? | userId? })` — set
    `assignedAgentId` XOR `assigneeUserId`, log to `AuditLog`. Assigning to a
    human stands the AI down (FR-AS-003, FR-HD-001).
  - `setStatus(conversationId, status)` — OPEN/PENDING/RESOLVED.
  - `addTag` / `removeTag` — manage `ConversationTag` rows.
- [ ] Role enforcement: a `requireRole("OWNER")` helper guards config APIs;
  inbox APIs accept OWNER or STAFF (FR-AU-009, FR-IC-005). `getAuthSession()`
  returns `role`.

### 7.7 Inbox / contacts / tags API routes

- [ ] `src/pages/api/dashboard/inbox/index.ts` — `GET` list conversations
  (filter by status, assignee, tag; paginated).
- [ ] `src/pages/api/dashboard/inbox/[id].ts` — `GET` conversation detail +
  messages.
- [ ] `src/pages/api/dashboard/inbox/[id]/messages.ts` — `POST` human reply.
- [ ] `src/pages/api/dashboard/inbox/[id]/assign.ts` — `POST` assign.
- [ ] `src/pages/api/dashboard/inbox/[id]/status.ts` — `PUT` set status.
- [ ] `src/pages/api/dashboard/inbox/[id]/tags.ts` — `POST` add/remove tags.
- [ ] `src/pages/api/dashboard/inbox/stream.ts` — `GET` SSE stream of inbox
  updates (new messages, conversation changes) for the tenant. **No Redis** —
  in-process event fanout; fallback polling via `?since=`.
- [ ] `src/pages/api/dashboard/contacts/` — `index.ts` (GET list), `[id].ts`
  (PUT edit). (Creation is auto from inbound; Phase 3 may add basic CRUD.)
- [ ] `src/pages/api/dashboard/tags/` — `index.ts` (GET list), POST create
  (OWNER).
- [ ] All routes authenticated, tenant-scoped, Zod-validated, role-checked.

### 7.8 Webhook + outbound error handling

- [ ] Cloud API webhook: invalid payloads → 200 (no Meta retry), log. Return
  200 within 5s (Meta timeout); agent processing continues.
- [ ] Baileys: socket disconnect/reconnect handling; re-auth from stored keys.
- [ ] Outbound send failures (both providers): log, do NOT auto-retry (avoid
  spam). On agent-processing failure, send the customer a generic error:
  "Maaf, sedang ada kendala teknis. Silakan coba lagi nanti."
- [ ] Log 429/rate-limit responses from Cloud API.

---

## Build Gate

- [ ] `npm run build` — zero errors.
- [ ] `npm run lint` — zero errors.
- [ ] Cloud API: webhook GET verify returns correct challenge; POST receives a
  message → conversation + contact + inbound message created → AI responds.
- [ ] Baileys: QR login completes; inbound message → same ingest path → AI
  responds.
- [ ] Human reply from the inbox API → message sent via the active provider →
  outbound Message persisted.
- [ ] Assign a conversation to a human → AI stops responding on it; reassign
  to AI → AI resumes.
- [ ] Add a "needs follow-up" tag → filter the inbox by it.
- [ ] Baileys onboarding shows the ToS/ban-risk warning and requires
  acknowledgement.
- [ ] End-to-end demo flow works (PRD §21 steps 6-8) on at least one provider.

---

## Files Created/Modified

```
src/
├── services/whatsapp/
│   ├── provider.ts          (common WhatsAppProvider interface + InboundMessage)
│   ├── index.ts             (getProvider dispatch + sendText/markAsRead)
│   ├── ingest.ts            (shared inbound ingest path)
│   ├── whatsapp-cloud.ts    (Cloud API provider)
│   └── whatsapp-baileys.ts  (Baileys provider, in-process socket)
├── lib/
│   ├── inbox.ts             (conversation lifecycle, assignment, handoff, tags, reply)
│   └── auth.ts              (add requireRole helper, role in getAuthSession)
├── pages/api/
│   ├── webhooks/whatsapp.ts (Cloud API GET verify + POST; calls ingest path)
│   ├── dashboard/channels/  (connect accepts provider + Baileys QR + tosAcknowledged)
│   ├── dashboard/inbox/     (index, [id], [id]/messages, [id]/assign, [id]/status, [id]/tags, stream)
│   ├── dashboard/contacts/  (index, [id])
│   └── dashboard/tags/      (index)
└── types/
    └── whatsapp.ts          (Zod schemas; add provider/onboarding schemas)
```

---

## Notes

- The old `src/services/whatsapp.ts` single-module is replaced by the
  `services/whatsapp/` directory (provider interface + two impls + ingest).
- Tools (Phase 5) are **provider-agnostic**: the Tool Gateway is unchanged.
  The provider only affects how messages get in/out of WhatsApp, not how the
  agent reads/writes business data.
- Baileys sockets live in the app process (single-process rule). If many
  tenants run Baileys and RAM grows, move to a sidecar container (future).
- Baileys is opt-in and ToS-risky; Cloud API is the safe default. Never default
  a channel to Baileys without owner acknowledgement.
- The inbox UI itself is Phase 8; this phase ships the backend APIs the UI calls.
- WhatsApp Cloud API requires HTTPS. TLS is Phase 10. For local dev, use ngrok
  or similar for the Cloud API webhook; Baileys needs no public endpoint.
