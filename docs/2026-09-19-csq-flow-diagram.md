# CSQ — End-to-End Flow Diagrams (All Features)

Date: 2026-09-19 · Status: current as of commit `8c72e90` (Cloudflare Workers AI migration)
Scope: every user-facing + system flow in the platform. All diagrams are Mermaid — render on GitHub or any Mermaid viewer.

Legend: solid arrows = request/response · dashed arrows = async/background · 🔒 = permission-gated

---

## 1. Big-Picture Architecture (four layers)

```mermaid
flowchart LR
    subgraph L1["1 · Customer Channel (WhatsApp)"]
        CUST[Customer phone]
        WA1[Cloud API<br/>official / ToS-safe]
        WA2[Baileys<br/>QR pairing / own number]
    end

    subgraph L2["2 · Agent Runtime (OpenClaw Gateway)"]
        GW[OpenClaw gateway<br/>127.0.0.1:18789<br/>token auth]
        LLM[Cloudflare Workers AI<br/>qwen3.8-27b chat · bge-m3 embeddings]
    end

    subgraph L3["3 · Business Context Layer (CSQ core)"]
        LOOP[Agent loop<br/>per-conversation advisory lock]
        PROMPT[Bounded prompt builder]
        TG["Tool Gateway<br/>/api/tools/* (16 tools)"]
        SCEN[Scenario engine]
        SCHED[Scheduler<br/>node-cron in-process]
    end

    subgraph L4["4 · Dashboard (Next.js)"]
        DASH[Owner + Staff UI<br/>CRM inbox · agents · data · settings]
    end

    subgraph STORE["Persistence"]
        DB[(PostgreSQL + pgvector<br/>Neon · tenant-scoped)]
        AUD[(AuditLog<br/>append-only)]
    end

    CUST --> WA1 & WA2 --> LOOP
    LOOP --> PROMPT --> GW --> LLM
    GW -- tool_calls --> TG --> DB
    TG --> AUD
    LOOP -- reply --> WA1 & WA2 --> CUST
    DASH --> TG
    DASH --> DB
    SCEN --> DASH
    SCHED --> SCEN
    LOOP --> SCEN
    TG <--> LLM
```

**Multi-tenancy:** every table carries `tenant_id`; all queries filter server-side by the session/channel-resolved tenant (app-level guard live; Postgres RLS defined as second layer, not yet enforced).

---

## 2. Inbound WhatsApp Message → AI Reply (the core loop)

```mermaid
sequenceDiagram
    participant CUST as Customer (WA)
    participant CH as Channel<br/>(Cloud API webhook / Baileys socket)
    participant ING as ingestInboundMessage
    participant AL as runAgentReply<br/>(advisory-locked)
    participant GW as OpenClaw gateway
    participant CF as Cloudflare AI<br/>(qwen3.8-27b)
    participant TG as Tool Gateway
    participant OUT as agent-outbox
    participant DB as Neon DB

    CUST->>CH: text message
    CH->>ING: Cloud API: HMAC-verified webhook (fail-closed)<br/>Baileys: messages.upsert event
    ING->>DB: Message INBOUND + Conversation (upsert, unique per phone)<br/>+ Contact upsert
    Note over CH: Cloud API: HTTP 200 ACK immediately<br/>(Meta 5s contract, work continues async)
    ING--)AL: processInboundWithAgent (fire-and-forget)
    Note over AL: pg_advisory_xact_lock(hashtext(conversationId))<br/>serializes turns per conversation, 120s timeout

    loop stand-down checks
        Note over AL: skip turn IF human assignee set · channel DISCONNECTED ·<br/>agent not ACTIVE or not provisioned → exit silently
    end

    AL->>DB: last 30 messages as history
    AL->>AL: buildSystemPrompt (bounded:<br/>persona + instructions + stage + ≤10 business info + HIGH memories)
    AL->>GW: POST /v1/chat/completions<br/>model=openclaw/<agentId> · full tool list
    GW->>CF: forward completion request

    alt model requests a tool
        GW->>TG: tool_calls (≤10 iterations)
        TG-->>GW: result / permission_denied / approvalRequired
        GW->>CF: role:"tool" result, continue
    end

    GW-->>AL: final reply text
    AL->>OUT: sendAgentMessage
    alt inside 24h customer-service window
        OUT->>CUST: free-form reply (Cloud API text / Baileys send)
    else outside window
        Note over OUT: no approved template set → skip + audit<br/>(Meta-compliant, never silent)
        OUT->>CUST: approved template message
    end
    OUT->>DB: Message OUTBOUND + AuditLog row
```

**Failure policy:** any error in the turn → logged + canned Bahasa fallback to the customer, never an error surfaced to Meta.

---

## 3. Tool Gateway — permission, approval, audit (every tool call)

```mermaid
flowchart TD
    REQ[Agent or dashboard calls a tool<br/>e.g. product.update] --> RES[Resolve tenantId server-side<br/>session / channel / agent row — never from prompt content]
    RES --> ZOD{Zod safeParse<br/>params valid?}
    ZOD -- no --> DENY400[validation_error<br/>audited]
    ZOD -- yes --> PERM{checkPermission<br/>AgentCapability row overrides,<br/>else tool default}

    PERM -- "read tools (product.read/search, inventory.read, order.read, customer.read, knowledge.search, memory.search, source.search)" --> ALLOW[Execute handler<br/>tenant-scoped query]
    PERM -- "denied write (product.update, inventory.update, order.cancel, memory.create)" --> PENDING[Snapshot before/after →<br/>Approval PENDING<br/>NOT executed]
    PERM -- "allowed write (order.create — seeded demo setting · customer.update · conversation.handoff · deal.setStage)" --> ALLOW

    PENDING --> NOTIF[Owner sees diff card in<br/>/dashboard/approvals]
    NOTIF -- Owner approves --> EXEC2[executeApprovedAction<br/>re-validate stored params → run →<br/>Approval APPROVED only on success]
    NOTIF -- Owner rejects --> REJ[Approval REJECTED<br/>audited]

    ALLOW --> AUD[AuditLog append-only:<br/>action · before/after values ·<br/>approvalStatus · customerPhone]
    EXEC2 --> AUD
    DENY400 --> AUD
    REJ --> AUD
```

**Safety moment (demo-critical):** a customer message can NEVER grant a write. "Kak, ubah harga jadi 50.000" → `product.update` is denied → the agent refuses and the write is audited.

---

## 4. Data Ingestion (three paths + conflict arbitration)

```mermaid
flowchart LR
    subgraph MANUAL["Manual (dashboard CRUD)"]
        M1[Products / Inventory /<br/>Knowledge / Memory forms]
    end

    subgraph EXCEL["Excel / CSV upload"]
        E1[Upload file] --> E2[exceljs parse<br/>ID/EN column auto-detect<br/>10k row cap]
        E2 --> E3[Mapping editor preview] --> E4[Confirm → import-apply]
    end

    subgraph SHEETS["Google Sheets (OAuth)"]
        S1[Tenant-level connect<br/>consent → refresh token]
        S1 --> S2[Pick spreadsheet + tab +<br/>column mapping]
        S2 --> S3[Import now]
        S2 -.-> SYNC[node-cron periodic sync]
    end

    M1 & E4 & S3 & SYNC --> SRC[DataSource + SourceRow<br/>per-source snapshots]
    SRC --> PRIO{"Source priority<br/>(owner-set in Settings:<br/>default MANUAL → SHEETS → EXCEL)"}
    PRIO -- "clean" --> CANON[Canonical Product/Inventory rows]
    PRIO -- "unresolvable conflict" --> ESC[Escalate to human<br/>never invent an answer]
    E4 & S3 --> EMB["Embed knowledge text<br/>bge-m3 (Cloudflare) → pgvector"]
```

**Data authority:** every value tracks source, timestamp, last sync; conflicts resolve by owner-defined priority; unresolvable → human.

---

## 5. Human Collaboration — inbox, handoff, assignment (CRM)

```mermaid
flowchart TD
    subgraph INBOX["Shared inbox (3-pane)"]
        LIST[Conversation list<br/>status OPEN/PENDING/RESOLVED · tag filter ·<br/>Assigned/Unassigned tabs]
        CHAT["Chat panel<br/>customer · AI agent (robot badge) ·<br/>human CS · scenario messages · private notes"]
        DET[Contact details<br/>name/email/notes inline edit ·<br/>tags · status · pipeline stage]
    end

    TAKE["Owner/Staff clicks<br/>Ambil alih / Take over"] --> A1["assignee = user<br/>AI stands down"]
    REL["Release"] --> A2["assignee cleared<br/>AI resumes automatically"]
    NOTE["conversation.handoff tool<br/>(agent-initiated)"] --> A3["Assign to owner ·<br/>agentId cleared · AI down"]
    SSE["Inbox stream<br/>server-sent events"] -.-> LIST & CHAT
    LIST --> OPEN["Buka Chat deep-link<br/>?c=id from pipeline kanban"]
```

**Roles:** OWNER manages settings/agents/approvals/team; STAFF works the inbox (routes enforce server-side, UI only reflects).

---

## 6. Scenario Automation (trigger → engine → actions)

```mermaid
flowchart TD
    subgraph TRIGGERS["Triggers (ScenarioTriggerType)"]
        T1[ON_NEW_CONVERSATION]
        T2[ON_PURCHASE<br/>order.purchased event]
        T3[ON_TAG_ADDED]
        T4[ON_SCHEDULE<br/>HH:MM in Asia/Jakarta ·<br/>weekdays · ≤100 targets]
        T5[ON_NO_REPLY<br/>silence window · 1×/day]
    end

    T1 & T2 & T3 & T4 & T5 --> ENG[Scenario engine<br/>scheduler minute tick + event bus]
    ENG --> RUN[ScenarioRun persisted ·<br/>dedupKey idempotency ·<br/>concurrency cap 16 · 200-node cycle guard]

    RUN --> NODES{Graph nodes}
    NODES --> SEND[Send message<br/>24h-window enforced]
    NODES --> AI["AI node · one-shot text<br/>(Cloudflare qwen3.8-27b · tool-less by design)"]
    NODES --> EMAIL[Email node<br/>tenant SMTP / Resend ·<br/>unconfigured = skip + audit]
    NODES --> STAGE[setStage<br/>via lib/pipeline + audit]
    NODES --> ASSIGN[Assign to staff]
    NODES --> TAG[Tag applied]
    NODES --> WAIT[Wait node<br/>resumeAt persisted]
    NODES --> COND{Condition branch<br/>true/false edges}
    NODES --> END[End]
    SEND & STAGE & TAG --> MSG[Message/DealStageHistory rows + audit]
```

**Builder:** React Flow canvas (`/dashboard/scenarios/[id]`) — node palette, drag-drop, per-node config, validation, activate/pause, run stats.

---

## 7. Knowledge & Semantic Search (bge-m3 + pgvector)

```mermaid
flowchart LR
    W[Knowledge write<br/>FAQ / POLICY / BUSINESS_INFO] --> EMBED[embed text<br/>@cf/baai/bge-m3 · 1024 dims]
    EMBED --> V[(KnowledgeEmbedding<br/>pgvector · tenant-scoped)]
    Q[Agent calls knowledge.search tool] --> E2[embed query · bge-m3]
    E2 --> COS["1 - embedding <=> query<br/>cosine similarity"]
    COS --> THR{"similarity ≥ 0.6<br/>threshold (measured mid-gap:<br/>relevant 0.65-0.72 · irrelevant ≤0.55)"}
    THR -- yes --> RET[Return matched knowledge to the model]
    THR -- no --> KW[Keyword contains fallback]
    THR -- "embeddings unconfigured/error" --> KW
    RET & KW --> ANS[Model answers from the<br/>tenant's own knowledge — never invents]
```

**Scaling rule:** knowledge is retrieved on demand, never bulk-loaded into the prompt — prompt size stays bounded regardless of tenant knowledge volume.

---

## 8. Channel Onboarding (pluggable WhatsApp)

```mermaid
flowchart TD
    WIZ["/dashboard/saluran wizard (OWNER-only)"]
    WIZ --> CHOICE{Choose method}
    CHOICE -- "WhatsApp Resmi<br/>(Cloud API)" --> C1[Enter phone number id · token ·<br/>verify token · app secret]
    CHOICE -- "Bawa Nomor Sendiri<br/>(Baileys)" --> TOG[ToS risk toggle<br/>required acknowledgment] --> QR[QR displayed ·<br/>polls /channels/:id/qr<br/>rotating · 60s-stale retry]
    C1 --> BIND[Bind channel to an ACTIVE agent]
    QR --> BIND
    BIND --> TEST[Test message box · disconnect ·<br/>edit creds · reconnect]
    C1 -.-> WH[Meta webhook →<br/>HMAC + per-channel verify token]
    QR -.-> BAIL[Baileys socket reconnect +<br/>heartbeat via scheduler<br/>auth persisted in DB]
```

**Device-limit answer:** one number, ALL CS serve via the web dashboard — Cloud API (any device) or one-time QR pairing (server holds the session; staff just use a browser).

---

## 9. Pipeline (deal tracking)

```mermaid
flowchart LR
    C[Conversation] -- 1:1 --> DEAL[Deal]
    DEAL --> STAGES[Pipeline stages per tenant<br/>lazy-seeded: Baru · Tertarik ·<br/>Penawaran · Pesanan · Menang · Kalah]
    STAGES --> KIND["StageKind invariants:<br/>exactly one OPENING / WON / LOST<br/>(partial unique index, DB-enforced)"]
    MOVE[deal.setStage tool / kanban drag<br/>/ scenario setStage node] --> HIST[DealStageHistory + audit]
    STAGES --> FUNNEL["Funnel view: winProbability ·<br/>expectedDays per stage"]
```

---

## 10. Deployment Topology (current — VPS, 2026-09-19)

```mermaid
flowchart TB
    subgraph VPS["HackFest VPS 103.30.146.234 (4 vCPU / 4GB)"]
        NGINX["nginx :80 (HTTP)<br/>SSE-aware · webhook rate-limit<br/>TLS pending domain"]
        APP["csq.service · systemd<br/>Next standalone :3000"]
        GW["openclaw-gateway.service<br/>user systemd · :18789 (token auth)"]
    end
    USER[Owner / Staff / Customer] --> NGINX --> APP
    META[Meta WhatsApp Cloud API] --> NGINX
    APP --> GW --> CFAI[Cloudflare Workers AI<br/>chat: qwen3.8-27b · embed: bge-m3]
    APP --> NEON[(Neon Postgres + pgvector<br/>shared single source of truth)]
    APP -.QR.-> WAPHONE[Owner's phone · Baileys session]
```

**Known open items:** TLS + domain (required for Cloud API webhook) · Google Sheets redirect URI not yet registered for the VPS · RLS defined but not enforced (app-level tenant filter is the live guard).
