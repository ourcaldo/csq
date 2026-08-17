# Phase 7 — WhatsApp Channel (Webhook, Cloud API)

**Goal:** Connect the platform to WhatsApp via Meta's Cloud API. Receive customer
messages, route them to the agent, and send responses back. This completes the
end-to-end flow: customer → WhatsApp → webhook → agent → response → WhatsApp.
**PRD Reference:** Sections 4.4, 14 (Customer Service Agent), 23A (WhatsApp)
**Depends On:** Phase 5, Phase 6

---

## Tasks

### 7.1 WhatsApp service module

- [ ] Create `src/services/whatsapp.ts`:
  - `sendText(phoneNumberId, recipient, text): Promise<void>` — send a text
    message via WhatsApp Cloud API.
  - `sendInteractive(phoneNumberId, recipient, template): Promise<void>` —
    send interactive template (for structured responses like order confirmations).
  - `markAsRead(phoneNumberId, messageId): Promise<void>` — mark incoming
    message as read.
  - All calls use `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` from env.
  - Base URL: `https://graph.facebook.com/v18.0`.
  - Error handling: log errors, don't crash the process.

### 7.2 Webhook verification endpoint

- [ ] Create `src/pages/api/webhooks/whatsapp.ts`:
  - **GET handler** (verification):
    - Meta sends `hub.mode`, `hub.challenge`, `hub.verify_token`.
    - Compare `hub.verify_token` with `WHATSAPP_VERIFY_TOKEN` from env.
    - If match, return `hub.challenge` as plain text (status 200).
    - If no match, return 403.
  - **POST handler** (incoming messages):
    - Parse WhatsApp webhook payload (Zod-validated).
    - Extract: sender phone, message text, message ID.
    - Resolve tenant and agent from phone number → channel mapping.
    - Pass message to agent chat handler (Phase 6).
    - Send agent response back via WhatsApp API.
    - Mark incoming message as read.
    - Log the conversation.

### 7.3 Webhook payload parsing

- [ ] Create `src/types/whatsapp.ts` with Zod schemas:
  - `WhatsAppWebhookPayload` — full Meta webhook structure.
  - `WhatsAppMessage` — extracted message (sender, text, timestamp, id).
  - `WhatsAppEntry`, `WhatsAppChange`, `WhatsAppContact` — sub-schemas.
- [ ] Extract only what we need: phone number, message body, message ID,
  message type (text only for MVP — ignore images/audio/location).
- [ ] Validate before processing. Invalid payloads → 200 OK (don't retry).

### 7.4 Phone-to-tenant/agent resolution

- [ ] When a WhatsApp message arrives:
  1. Look up the sender's phone in the `Channel` table.
  2. Match to a tenant's WhatsApp channel configuration.
  3. Find the active agent for that channel.
  4. If no active agent found → reply with "Agent sedang tidak aktif" (agent offline).
  5. If no channel configured → ignore the message.
- [ ] WhatsApp phone numbers are configured in the dashboard (Phase 8).

### 7.5 Message flow — end to end

```
Customer sends WhatsApp message
        │
        v
Meta webhook → POST /api/webhooks/whatsapp
        │
        v
Parse payload → extract phone + message text
        │
        v
Resolve tenant + active agent from Channel table
        │
        v
POST /api/agents/[agentId]/chat (Phase 6)
        │
        v
OpenClaw processes message → may call tools via /api/tools/*
        │
        v
Agent response returned
        │
        v
WhatsApp API sends response to customer
        │
        v
Mark incoming message as read
        │
        v
Audit log entry created
```

### 7.6 Rate limiting and error handling

- [ ] WhatsApp Cloud API has rate limits. Log 429 responses.
- [ ] If sending fails, don't retry automatically (avoid spam). Log and notify
  dashboard (Phase 8).
- [ ] If agent processing fails, send a generic error response:
  "Maaf, sedang ada kendala teknis. Silakan coba lagi nanti."

### 7.7 WhatsApp channel configuration API

- [ ] Create `src/pages/api/dashboard/channels/`:
  - `index.ts` — `GET` (list channels for tenant).
  - `connect.ts` — `POST` (connect WhatsApp: store phone number ID, verify token,
    and test webhook).
  - `disconnect.ts` — `POST` (disconnect channel).
  - `test.ts` — `POST` (send a test message to verify connection works).
- [ ] Channel config stored in `Channel.config` json column (encrypted tokens
  stored in env for MVP — config holds non-secret identifiers).

### 7.8 Outbound message queue (simple)

- [ ] For MVP, send messages synchronously in the webhook handler.
- [ ] If latency becomes an issue, introduce a simple in-memory queue:
  - `src/lib/message-queue.ts` — process messages with `setImmediate`.
  - No Redis, no external queue. Keep it dumb.
  - **Only add if needed.** YAGNI until proven.

---

## Build Gate

- [ ] `npm run build` — zero errors.
- [ ] `npm run lint` — zero errors.
- [ ] Manual test: webhook verification (GET) returns correct challenge.
- [ ] Manual test: send test message via WhatsApp → agent responds.
- [ ] Manual test: agent denies unauthorized action → refusal message sent to customer.
- [ ] End-to-end demo flow works (PRD section 21, steps 6-8).

---

## Files Created/Modified

```
src/
├── services/
│   └── whatsapp.ts           (send, mark read, error handling)
├── pages/api/
│   ├── webhooks/
│   │   └── whatsapp.ts        (GET verify + POST receive)
│   └── dashboard/channels/
│       ├── index.ts
│       ├── connect.ts
│       ├── disconnect.ts
│       └── test.ts
├── types/
│   └── whatsapp.ts           (Zod schemas for webhook payload)
```

---

## Notes

- WhatsApp Cloud API requires HTTPS. TLS is set up in Phase 10 (Deployment).
  For local dev, use ngrok or similar tunnel.
- The webhook MUST return 200 quickly. If agent processing is slow, consider
  async processing. But for MVP, keep it synchronous — the HackFest demo
  handles one conversation at a time.
- Baileys is the documented fallback only. Do NOT implement it unless WhatsApp
  Cloud API becomes a blocker.
- Message media (images, audio, documents) is explicitly out of scope for MVP.
  Only text messages.
