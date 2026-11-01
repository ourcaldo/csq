# Phase 6 — OpenClaw Integration (Agent Runtime, Cells)

**Goal:** Integrate OpenClaw as the agent runtime. Create agent cells, register
tools, handle conversations, and wire the Tool Gateway into OpenClaw's
tool-calling mechanism.
**PRD Reference:** Sections 4.3, 23A (Agent Runtime), 26 (OpenClaw Role)
**Depends On:** Phase 5 (Tool Gateway)

---

## ⚠️ Open Risk: OpenClaw Integration Method

Before starting this phase, **validate against OpenClaw documentation:**

1. How does OpenClaw receive tool definitions? (HTTP API, config file, SDK?)
2. How does OpenClaw call tools? (HTTP webhook to our API, in-process function call?)
3. What is the resource footprint of an OpenClaw Gateway on a 4GB host?
4. Does OpenClaw support per-agent tool policies natively, or do we enforce
   via our Tool Gateway?

**If OpenClaw is HTTP-based (likely):**
- Our Next.js API routes (`/api/tools/*`) ARE the tool endpoints.
- OpenClaw calls them via HTTP POST.
- We register tool definitions with OpenClaw via its API.
- No separate process needed — just configuration.

**If OpenClaw requires a separate SDK/process:**
- May need a lightweight container or sidecar process.
- Could increase RAM usage beyond 4GB budget.
- Fall back: run OpenClaw as a Docker container alongside Next.js.

---

## Tasks

### 6.1 OpenClaw service module

- [ ] Create `src/services/openclaw.ts`:
  - `createCell(params: CreateCellParams): Promise<Cell>` — create an isolated
    OpenClaw cell for a tenant.
  - `deleteCell(cellId: string): Promise<void>` — remove a cell.
  - `createAgent(cellId, params: CreateAgentParams): Promise<Agent>` — create
    an agent within a cell.
  - `configureTools(cellId, agentId, tools: ToolDefinition[]): Promise<void>` —
    register our tools with the OpenClaw agent.
  - `sendMessage(cellId, agentId, message: string, sessionId?: string): Promise<AgentResponse>`
    — send a message to the agent, get response.
  - `configureInstructions(cellId, agentId, instructions: string): Promise<void>` —
    set the agent's system prompt/instructions.

- [ ] All calls go through HTTP to OpenClaw API (base URL from `OPENCLAW_BASE_URL`).
- [ ] Auth via `OPENCLAW_API_KEY` header.
- [ ] Error handling: retry on 5xx, fail fast on 4xx.

### 6.2 Agent provisioning flow

- [ ] When a user creates an agent in the dashboard:
  1. Create `Agent` record in our database (Phase 3).
  2. Create OpenClaw cell for tenant (if not exists).
  3. Create OpenClaw agent within the cell.
  4. Register tools from our registry (`listTools()`).
  5. Configure agent instructions from `Agent.instructions` field.
  6. Store OpenClaw cell/agent IDs in our `Agent` record (add fields: `openclawCellId`,
     `openclawAgentId`).

### 6.3 System prompt construction

- [ ] Create `src/services/prompt-builder.ts`:
  - Builds the agent's system prompt from:
    - Agent instructions (user-defined in dashboard).
    - Business context summary (tenant name, connected data sources).
    - Available tools list with descriptions.
    - Permission rules (what the agent can and cannot do).
    - Language instruction (Bahasa Indonesia).
    - Personality/persona from agent config.
  - The prompt MUST NOT include raw credentials, tokens, or system internals.
  - Treat all business data references as read-only in the prompt — actual
    writes happen through tools.

### 6.4 Conversation session management

- [ ] Create `src/pages/api/agents/[agentId]/chat.ts`:
  - `POST` — receives message from WhatsApp webhook (Phase 7).
  - Resolves tenant and agent from context.
  - Calls `openclaw.sendMessage()`.
  - Returns agent response.
- [ ] Session tracking: map WhatsApp phone number to OpenClaw session ID.
  - Uses the `Conversation` model (created in Phase 1, see Plan 02 task 1.2):
    - Fields: id, tenantId, agentId, customerPhone, openclawSessionId, lastMessageAt.
    - Unique on `(tenantId, agentId, customerPhone)` — one session per customer per agent.
  - On incoming message: find or create Conversation, pass `openclawSessionId`
    to `openclaw.sendMessage()`. Update `lastMessageAt` after each exchange.

### 6.5 Agent capability sync to OpenClaw

- [ ] When capabilities change in our database:
  - Re-register tools with OpenClaw (or update tool policies).
  - OpenClaw may support per-tool allow/deny — if so, sync our
    `AgentCapability` records.
  - If OpenClaw doesn't support this, our Tool Gateway handles it
    (permission check happens before execution regardless).

### 6.6 Agent status management

- [ ] Create `src/pages/api/dashboard/agents/[id]/deploy.ts`:
  - `POST` — set agent status to ACTIVE, create OpenClaw cell if needed.
- [ ] Create `src/pages/api/dashboard/agents/[id]/pause.ts`:
  - `POST` — set agent status to PAUSED, stop accepting messages.
- [ ] Paused agents: webhook returns a "not available" message to WhatsApp.

---

## Build Gate

- [ ] `npm run build` — zero errors.
- [ ] `npm run lint` — zero errors.
- [ ] Manual test: create agent → OpenClaw cell + agent created.
- [ ] Manual test: send message to agent → tool call executed through gateway
  → response returned.
- [ ] Manual test: agent with no write permissions → tool update call denied.

---

## Files Created/Modified

```
src/
├── services/
│   ├── openclaw.ts           (cell/agent CRUD, messaging, tool registration)
│   └── prompt-builder.ts     (system prompt construction)
├── pages/api/
│   ├── agents/
│   │   └── [agentId]/
│   │       ├── chat.ts       (message handling)
│   │       ├── deploy.ts     (activate agent)
│   │       └── pause.ts      (pause agent)
│   └── dashboard/agents/
│       └── [id]/
│           ├── deploy.ts
│           └── pause.ts
```

---

## Decisions Needed

| Decision | Options | Recommendation |
|----------|---------|----------------|
| OpenClaw communication | HTTP API, SDK, WebSocket | **HTTP API** — simplest, works with our existing Next.js routes as tool endpoints |
| Session storage | Database table, in-memory Map, OpenClaw native | **Database** (Conversation table) — survives restarts, queryable for dashboard |
| OpenClaw as Docker container or in-process | Separate container, in-process | **Depends on validation** — if RAM allows, separate container for isolation |

---

## Fallback Plan

If OpenClaw integration proves too complex or resource-heavy for the HackFest:
- Implement a simplified agent loop directly in Next.js:
  - Receive message from WhatsApp.
  - Call an LLM API (OpenAI or similar) with the system prompt + tool definitions.
  - Parse tool calls from LLM response.
  - Execute through our Tool Gateway.
  - Return result to LLM, then to WhatsApp.
- This preserves the entire Tool Gateway architecture. Only the agent runtime
  changes from OpenClaw to direct LLM API calls.
- **Do NOT implement this unless OpenClaw validation fails.**
