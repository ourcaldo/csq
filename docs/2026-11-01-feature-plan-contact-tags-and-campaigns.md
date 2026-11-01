# Feature Plan — Contact Tags & Categories + Campaigns (Message Blasting)

**Date:** 2026-11-01
**Status:** In discussion — round 1 answered and folded in (section 9); the four open decisions in
section 5 gate implementation.
**Requested by:** owner, 2026-11-01
**Depends on:** the 2.0.0 defect fixes (`docs/2026-10-31-fix-plan-10-defects.md`) — campaigns reuse the
system lock, the scheduler tick, the template library, and the outbox's window rules.

---

## 1. What exists today (verified in code)

These facts drive every design choice below — nothing is assumed.

| Area | Today |
|---|---|
| `Contact` | `tenantId, phone, name, email, notes` — no tags, no category (`prisma/schema.prisma`) |
| `Tag` | Tenant-scoped taxonomy (`name`, auto-color) with a **conversation** join (`ConversationTag`) — tags exist but only attach to conversations (`src/pages/api/dashboard/tags/*`) |
| Contacts API | `GET /api/dashboard/contacts` (search by name/phone/email), `PUT [id]` (name/email/notes, OWNER-only, audited) |
| Contacts UI | `src/pages/dashboard/contacts/index.tsx` — list + search + edit dialog. Inbox has `src/components/dashboard/inbox/contact-details.tsx` (info + Riwayat timeline) |
| Templates | `Tenant.settings.messageTemplates` with two kinds: **CSQ** (free-form body, no Meta approval needed) and **META** (the name of a pre-approved Meta template, for sends outside the 24h window) — `src/lib/message-templates.ts` |
| 24h window | Cloud API: free-form text only within 24h of the customer's last inbound; outside it, only a pre-approved META template. Enforced in `agent-outbox.ts` and `scenario-engine.ts`. **Baileys bypasses the window but `sendTemplate` literally sends the template NAME as text** (`services/baileys.ts`) |
| Scheduling | Every-minute cron tick (`scheduler.ts`) drives scenario resumes and ON_SCHEDULE fires; **`SystemLock` lease** makes ticks single-instance (D10d); schedules interpret in `SCENARIO_SCHEDULE_TZ` (default `Asia/Jakarta`); ticks are bounded per pass (scenario engine caps at 50) |
| Outbound records | Every send creates an `OUTBOUND` `Message` row on the conversation (`senderType` AGENT/HUMAN/SCENARIO) + audit; conversations are find-or-created per (channel, phone) |
| Bounded patterns | Scenario runs persist state rows and are resumed by the tick — crash-safe, no in-process unbounded loops. Same pattern applies to campaigns |
| Menu | `NAV_GROUPS` in `src/components/dashboard/dashboard-shell.tsx` — a new menu item is a one-line addition |

Live data context: **8 contacts, 1 conversation tag** — segmentation starts empty; the owner creates
categories/tags as they adopt the feature.

---

## 2. Feature 1 — Contact tags and categories

### 2.1 Product definition

- **Tags (many per contact):** flexible, multi-purpose labels owned by the tenant — "grosir",
  "suka arabica", "menunggu restock". Same object as conversation tags (one taxonomy), attached to
  a new join table.
- **Category (one per contact):** the customer's group/classification — "Reseller", "Retail", "VIP".
  A single-select field, managed by the owner, filterable, and the primary campaign targeting axis.
- Both appear on the contacts page (columns + filters), in the inbox contact panel, and in the
  campaign audience picker.

### 2.2 Decisions (recommendations in bold)

| # | Decision | Status after owner round 1 (2026-11-01) |
|---|---|---|
| 1.1 | Category multiplicity | **CONFIRMED: many-to-many** — a contact can be in multiple categories, same as tags. Schema changed to a join table (2.3). |
| 1.2 | Tag taxonomy | **CONFIRMED** — one shared `Tag` list for conversations and contacts (`ContactTag` join) |
| 1.3 | Where tags/categories appear | **CONFIRMED by owner** — contacts page AND the conversation/inbox contact panel, not only the contacts page |
| 1.4 | Who may tag/categorize | **OWNER** (matches the existing OWNER-only `PUT /contacts/[id]`); STAFF tagging listed as a follow-up decision |
| 1.5 | Category management UI | **A "Kategori Kontak" section on the existing Tag page** (one taxonomy screen) rather than a new menu item |

### 2.3 Schema (one migration)

Round 1 change: categories are many-to-many, symmetric with tags — the taxonomy row follows the
`Tag` pattern and the join follows the `ConversationTag`/`ContactTag` pattern.

```prisma
// Taxonomy row, like Tag: tenant-scoped list of categories ("Reseller", "VIP").
model Category {
  id        String   @id @default(uuid())
  tenantId  String
  name      String
  color     String?            // same normalize/random hex pattern as Tag
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  contacts  ContactCategory[]

  @@unique([tenantId, name])   // stable names — campaigns reference them by id
}

// Join, like ConversationTag: a contact can be in MANY categories.
model ContactCategory {
  id         String  @id @default(uuid())
  tenantId   String
  contactId  String
  categoryId String
  contact    Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)
  category   Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@unique([contactId, categoryId])
  @@index([tenantId, categoryId])
}

model ContactTag {
  id        String  @id @default(uuid())
  tenantId  String
  contactId String
  tagId     String
  contact   Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)
  tag       Tag     @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@unique([contactId, tagId])
  @@index([tenantId, tagId])
}

model Contact {
  // existing fields...
  categories ContactCategory[]   // resolved through the join
  tags       ContactTag[]
}
```

Tag gains a `contactTags ContactTag[]` relation. RLS: the coverage rule from D9 applies — the new
`Category`, `ContactCategory` and `ContactTag` tables carry `tenantId` and the migration adds their
policies.

### 2.4 API

| Route | Method | Notes |
|---|---|---|
| `/api/dashboard/contact-categories` | GET, POST | OWNER for POST; POST upserts by name so the same category cannot duplicate |
| `/api/dashboard/contact-categories/[id]` | PUT, DELETE | DELETE removes the join rows only (Cascade) — contacts are never deleted |
| `/api/dashboard/contacts` | GET | include `categories` + `tags` (via joins); new filters `?categoryId=`, `?tagId=` (OR within a set, AND across tag+category) |
| `/api/dashboard/contacts/[id]` | PUT | `contactUpdateSchema` gains optional `categoryIds: string[]` and `tagIds: string[]` (replace-set semantics; unknown ids → 400) |

Zod at every boundary; every query tenant-scoped; mutations audited (`contact.update` before/after
now includes the classification).

### 2.5 UI

- **Contacts page:** two new columns (category chips, tag chips), a filter bar (category select +
  tag select), and the edit dialog gains a category multi-select + tag multi-select (round 1: a
  contact may carry several of each; reuse the Tag page's chip/color rendering; a small inline
  "create tag"/"create category" affordance on OWNER).
- **Tag page:** second section "Kategori Kontak" (same table + dialog pattern as tags).
- **Inbox contact panel (`contact-details.tsx`):** category + tag chips under the contact name —
  shown in the conversation view per the owner's round-1 answer, with an OWNER edit affordance
  reusing the same dialog.

### 2.6 Verification

- Self-check: contact update with an unknown tagId → 400; duplicate `ContactTag` rejected by the
  unique constraint; category delete detaches (SetNull) and does not delete contacts.
- Build + lint + `check:encoding`; RLS coverage re-check (new tables get policies — the D9 rule).
- Manual: tag 2 contacts, filter by tag, confirm the campaign audience preview (Feature 2) counts them.

---

## 3. Feature 2 — Campaigns (message blasting)

### 3.1 Product definition (the request, made concrete)

The owner creates a **campaign**: a name, an **audience** (all contacts / one category / one or more
tags / a hand-picked contact list), a **message** (from the template library or written fresh), a
**schedule** (one time at a specific time, daily at a time, weekly on a weekday, monthly on a
day, or every N days), and a **pacing delay** (send every X seconds). The platform then delivers the
message to every recipient over WhatsApp, spread over time, with a per-recipient delivery log.

### 3.2 THE constraint, by channel — and what "template" actually means

Two different things are both called "template":

- **Internal templates** (the "Template Pesan" page, kind `CSQ`): saved text the owner writes.
  Meta knows nothing about them; they are sendable as free text **wherever free text is allowed**.
- **Meta templates** (kind `META`): messages created and submitted for approval in Meta Business
  Manager. Needed **only when free text is not allowed**.

When is free text allowed? This is Meta's server-side rule, not ours — the app's own outbox already
enforces it, and the production `AuditLog` contains `conversation.agent_send_skipped_window`
entries from exactly this rule:

| Channel | Free text to a customer |
|---|---|
| **Baileys** (own number, QR) | **Always.** No window, no Meta templates ever. Trade-off: the number can be banned by WhatsApp (the ToS risk the product already documents and gates behind `tosAcknowledged`). |
| **Cloud API** (official — the live channel today) | **Only within 24h of that customer's last inbound message.** Outside the window Meta's API rejects free text (error 131047) and only an approved Meta template is accepted. |

Per-recipient send policy for a campaign on the Cloud API:

| Recipient state | `body` (internal template / typed text) | `META` template |
|---|---|---|
| chatted < 24h ago | send free-form | send template |
| no chat ≥ 24h | **SKIPPED + reason `window_closed`** — never sent, Meta would reject | send template |

On Baileys every recipient gets `body`. There is no technical workaround for the Cloud API side:
the rejection happens on Meta's servers. Practical consequences built into the plan:

1. A campaign saves a **content snapshot** at creation time: `body` (from an internal template or
   typed fresh) and, when a META template is chosen, `metaName`/`metaLanguage` too. Editing a
   template later must not silently change a scheduled campaign.
2. The create form warns in plain language when a free-form campaign runs on a Cloud API channel:
   "hanya pelanggan yang chat <24 jam terakhir yang bisa menerima pesan bebas; sisanya dilewati.
   Pakai template META untuk menjangkau semua." Reaching *everyone* on the Cloud API needs exactly
   one approved template — a free, one-time submission in Meta Business Manager.
3. Recipients whose window is closed are recorded `SKIPPED` with a reason — never a silent drop.
4. **Meta volume limits:** business-initiated messages per 24h are tier-limited (250 for an
   unverified number, 1k once verified). The create form shows the resolved audience size and a
   plain-language warning when it exceeds the likely tier. Per-recipient provider failures become
   `FAILED` rows and the blast continues.

### 3.2.1 Rich content: text, image, buttons (owner round 1)

Requested: a campaign message can be image + text + buttons. What is technically possible, per
channel and window state:

| Content | Cloud API, inside 24h | Cloud API, outside 24h | Baileys |
|---|---|---|---|
| Text | free | template only | free |
| Image + caption | free (media send by public image URL) | as the approved template's image header | free (URL fetched in-process) |
| Buttons (quick reply / CTA) | allowed as an "interactive message", no approval | **only inside an approved Meta template** | unreliable — WhatsApp deprecated buttons for non-template messages; not offered |

Scope decisions that follow:

- **Buttons in a blast to inactive customers = a Meta-approved template, always.** The buttons are
  designed once in Meta Manager; the campaign sends the template by name. There is no free-form
  button path there.
- **v1 proposal:** text; text + image by public URL (no upload/storage infrastructure — Meta
  fetches the URL, Baileys downloads it in-process); buttons via META templates only.
- In-window interactive buttons (Cloud API) and a real upload flow are deferred to v2 — both are
  separate provider-code and infrastructure work.

### 3.3 Decisions (recommendations in bold)

| # | Decision | Status after owner round 1 (2026-11-01) |
|---|---|---|
| 2.1 | Recurring audience | **CONFIRMED by owner** — every fire sends to everyone matching the audience at that moment (category/tag audiences include customers tagged after the campaign was created; MANUAL selection stays a fixed list) |
| 2.2 | Permissions | **REOPENED** — "OWNER-only" explained in round 1: the app has OWNER (full control) and STAFF (invited inbox team) roles. The question: may a STAFF account create/launch campaigns? **Recommendation: no** — one click messages every customer at once |
| 2.3 | Sender identity in the inbox | **New `MessageSenderType.CAMPAIGN`** (not reusing SCENARIO), so campaign sends are distinguishable in the inbox and audit |
| 2.4 | Does the AI answer replies? | **Yes — unchanged plumbing:** a reply is a normal inbound; the turn lease/drain handles it. Campaign sends deliberately do NOT count as "answered" for the drain (same exclusion as SCENARIO) |
| 2.5 | Pacing accuracy | **Best-effort with 1-minute scheduler granularity** (a 10s delay sends ~6/min; a crash resumes exactly where the per-recipient rows left off) |
| 2.6 | Marketing opt-out | **DROPPED by owner.** Meta's marketing templates carry their own opt-out button set in Meta Manager — nothing needed in our code |
| 2.7 | Schedule timezone | **Reuse `SCENARIO_SCHEDULE_TZ`** (already documented, default Asia/Jakarta) |
| 2.8 | Channel selection | Campaign stores `channelId`; the form lists CONNECTED channels. **OPEN (round 1):** which channel carries campaigns in practice — see 3.2; it decides whether Meta templates are needed at all |
| 2.9 | Menu placement | **"Kampanye" in the Utama group** of the sidebar |
| 2.10 | Rich content scope | **OPEN (round 1):** proposed v1 = text + optional image by public URL; buttons via META templates. Real upload/storage and in-window interactive buttons deferred (3.2.1) |

### 3.4 Schema (one migration, same release as Feature 1 or its own)

```prisma
enum CampaignStatus    { DRAFT ACTIVE PAUSED COMPLETED ARCHIVED }
enum CampaignAudience  { ALL CATEGORY TAGS MANUAL }
enum CampaignScheduleKind { ONCE DAILY WEEKLY MONTHLY INTERVAL }
enum CampaignSendKind  { BODY META_TEMPLATE }   // BODY = free-form/CSQ; META = pre-approved template
enum CampaignMessageStatus { PENDING SENT FAILED SKIPPED }
// MessageSenderType gains: CAMPAIGN

model Campaign {
  id           String   @id @default(uuid())
  tenantId     String
  channelId    String                       // the WhatsApp channel that sends
  name         String
  status       CampaignStatus @default(DRAFT)
  // Audience
  audience     CampaignAudience
  categoryIds  String[]                     // CATEGORY mode (OR across selected categories)
  tagIds       String[]                     // TAGS mode (OR)
  contactIds   String[]                      // MANUAL mode (snapshot)
  // Content snapshot (resolved at save time — later template edits never
  // silently change a scheduled campaign)
  sendKind     CampaignSendKind
  body         String                        // free-form / CSQ body; also the Baileys text
  mediaUrl     String?                       // optional public image URL (round 1, 3.2.1)
  metaName     String?                       // META: approved template name
  metaLanguage String? @default("id")
  // Schedule (interpreted in the platform schedule TZ)
  scheduleKind CampaignScheduleKind
  scheduleConfig Json                        // {time:"09:00"} | +{dayOfWeek:1} | +{dayOfMonth:15} | {everyDays:3,time:"09:00"}
  nextRunAt    DateTime?                     // due check by the tick
  lastRunAt    DateTime?
  createdAt/updatedAt
  runs         CampaignRun[]
  @@index([tenantId, status, nextRunAt])
}

model CampaignRun {                           // one fire of one campaign
  id, tenantId, campaignId
  startedAt  DateTime @default(now())
  finishedAt DateTime?
  counts     Json?                            // {total,sent,failed,skipped} summary on finish
  @@index([tenantId, campaignId, startedAt])
}

model CampaignMessage {                       // per recipient per fire — the pacing + resume log
  id, tenantId, runId
  contactId String
  phone     String                            // snapshot: contacts can be deleted later
  status    CampaignMessageStatus @default(PENDING)
  scheduledFor DateTime                       // fire start + index * delaySeconds
  sentAt    DateTime?
  waMessageId String?
  reason    String?                            // window_closed / provider error text
  @@index([runId, status, scheduledFor])
}
```

Round 1 change: categories are many-to-many, so the campaign audience selects one or more
categories (OR semantics). `marketingOptOut` was dropped by the owner (decision 2.6).

Why `scheduledFor` instead of "loop with sleep": a 500-recipient blast at 30s pacing runs ~4 hours.
An in-process loop dies with the process and cannot resume. Pre-computed per-recipient rows are the
same crash-safe pattern the scenario engine uses (`ScenarioRun.resumeAt` + minute tick).

### 3.5 Engine (server-only, `src/lib/campaign-engine.ts`)

Wired into the existing every-minute tick as its own locked unit, next to `scenario-tick`:

```
withSystemLock("campaign-tick", 90, processCampaigns)
```

`processCampaigns()` per tick (all queries tenant-scoped via joins, bounded per pass):

1. **Fire due campaigns:** `status=ACTIVE, nextRunAt <= now`, take ≤ 5/tick. For each:
   resolve the audience (fresh for ALL/CATEGORY/TAGS — `marketingOptOut=false`; MANUAL = stored
   `contactIds`), create a `CampaignRun`, create `CampaignMessage` rows with
   `scheduledFor = fireStart + i * delaySeconds`, stamp `lastRunAt`, and compute `nextRunAt`
   (next occurrence in the schedule TZ; ONCE → `null` + status stays ACTIVE until the run finishes,
   then COMPLETED). Audience of 0 → run marked finished with zero counts, no error.
2. **Deliver due messages:** `status=PENDING, scheduledFor <= now`, take ≤ 100/tick (the pacing
   safety net — with realistic delays the tick finds only a handful). For each (skipped entirely
   while the parent campaign is PAUSED):
   - Find-or-create the conversation for (channel, phone) — replies then land in the shared inbox.
   - Send per the policy matrix in 3.2 (Cloud API window check; META template outside the window;
     Baileys always sends `body`).
   - Record an `OUTBOUND` Message row (`senderType: CAMPAIGN`, `kind: TEXT`), stamp the
     conversation `lastMessageAt`, update the recipient row (`SENT`/`FAILED`/`SKIPPED` + reason +
     `waMessageId`). A recipient error never aborts the batch.
3. **Close finished runs:** runs with no `PENDING` left get `finishedAt` + counts.
4. **Audit:** one row per lifecycle event (`campaign.create/update/activate/pause/delete`,
   `campaign.fire` with the audience counts) — per-recipient traceability lives in
   `CampaignMessage`, so a 500-recipient blast does not create 500 audit rows.

Idempotency: a redelivered tick cannot double-send — the tick runs under the `SystemLock` lease and
each row flips PENDING→sent-atomically via `updateMany where status=PENDING` before sending.

### 3.6 API

| Route | Method | Notes |
|---|---|---|
| `/api/dashboard/campaigns` | GET, POST | POST validates the audience references and resolves the content snapshot (template → body/metaName) |
| `/api/dashboard/campaigns/[id]` | GET, PUT, DELETE | PUT only while DRAFT or PAUSED (an ACTIVE campaign is paused first — never edited live) |
| `/api/dashboard/campaigns/[id]/activate` | POST | DRAFT/PAUSED → ACTIVE; computes the first `nextRunAt` |
| `/api/dashboard/campaigns/[id]/pause` | POST | ACTIVE → PAUSED (in-flight PENDING rows stay PENDING and resume on activate) |
| `/api/dashboard/campaigns/[id]/runs` | GET | run list with counts; `?runId=` returns that run's message log (paged) |
| `/api/dashboard/campaigns/preview` | POST | audience resolution preview: `{total, byCategory}` — powers the form's live count |

All OWNER-only, Zod-validated, tenant-scoped, audited.

### 3.7 UI (`/dashboard/campaigns`)

- **List page:** status cards (total, ACTIVE, messages sent this month from run counts), a table of
  campaigns (name, audience summary, schedule summary, next run (id-ID), status badge, actions:
  edit / pause-activate / delete with ConfirmDialog), and an expandable run history per campaign
  (per-run counts + a paged message log with statuses and skip reasons).
- **Create/edit wizard dialog** (steps mirroring the owner's mental model):
  1. **Nama & saluran** — name + channel picker (CONNECTED channels only).
  2. **Penerima** — audience: Semua / Kategori (multi-select, OR) / Tag (multi) / Pilih manual
     (contact picker); live preview count from `/preview`, the Meta tier warning.
  3. **Pesan** — from the tenant template library (CSQ or META) or write fresh; optional image URL
     (round 1: public link, Meta fetches it / Baileys downloads it); body preview with the
     24h-window warning when the message is free-form on a Cloud API channel; when a META template
     is chosen, a note that buttons live inside the template as designed in Meta Manager.
  4. **Jadwal & tempo** — schedule kind + time (and weekday/day-of-month/every-N-days as
     applicable), delay seconds (min 10s, default 30s), summary line: "± 120 kontak × 30 dtk ≈
     60 menit per kirim".
- Reuses `DashboardShell`, the existing Dialog/Badge/Table components, and the Tag page's chip
  styling; one new nav item in `NAV_GROUPS` (decision 2.9).
- Contact panel (Feature 1) also shows the opt-out toggle for OWNER.

### 3.8 Verification

- **Self-check (pure logic):** next-occurrence computation for all 5 schedule kinds across a fixed
  clock (daily 09:00, weekly Monday, monthly 31st→clamp, INTERVAL every 3 days) — the same
  assert-based pattern as `scripts/self-check-scope.ts`.
- **Live-SQL:** the PENDING claim update (`updateMany ... where PENDING`) and the SystemLock reuse.
- **Manual:** a 3-contact campaign with 10s delay → 3 SENT rows, 3 CAMPAIGN Message rows visible in
  the inbox, run counts correct, next fire time correct for each schedule kind; pause mid-blast →
  sends stop, activate → they resume; a window-closed recipient on Cloud API free-form → SKIPPED
  with `window_closed`, and the same recipient reached when the campaign uses a META template.

---

## 4. Migration plan

| # | Migration | Contents |
|---|---|---|
| 1 | `20261101010000_contact_classification` | `Category`, `ContactCategory` join, `ContactTag` join, relations on `Contact`/`Tag`; RLS policies for the three new tenant tables (the D9 coverage rule — verified 30/30 today, becomes 33/33) |
| 2 | `20261101020000_campaigns` | 5 enums (`MessageSenderType` gains `CAMPAIGN`), `Campaign`, `CampaignRun`, `CampaignMessage`, indexes; RLS policies for the three new tenant tables |

Additive only; applied to Neon over MCP with `_prisma_migrations` bookkeeping (checksums via
`npm run db:migration-checksums`), the workflow established in the 2.0.0 fixes.

---

## 5. Open decisions — remaining after round 1 (2026-11-01)

Answered in round 1: multi-category/multi-tag contacts (confirmed), shared tag taxonomy (confirmed),
tags/categories shown in the conversation panel (confirmed), recurring audience resolved fresh per
fire (confirmed), manual opt-out flag (dropped).

| # | Question | Recommendation |
|---|---|---|
| 1 | **Which channel carries campaigns in practice?** This single choice decides whether Meta templates are needed at all (3.2). Options: the live Cloud API number (approved templates required for customers silent >24h) or a Baileys number (free text to everyone, ban risk) or both (per-campaign choice — the schema already stores `channelId`). | Support both, per-campaign choice; warn per the send matrix |
| 2 | **v1 rich content:** text only, or text + image by public URL (no upload infra)? Buttons are META-template-only either way (3.2.1). | Text + image-by-URL in v1 |
| 3 | May STAFF accounts create/launch campaigns, after the owner-only explanation (round 1, 3.3 #2.2)? | No — OWNER only |
| 4 | Tags/categories in the inbox panel: OWNER can edit them right there, or view-only in v1? | Editable (reuses the contacts dialog) |

---

## 6. Build order (each phase = build + lint + verification + commit + push)

1. **Phase A — contact classification:** migration 1, categories CRUD + contact tag/category API,
   contacts page UI (columns, filters, edit dialog), Tag page category section, inbox panel chips.
2. **Phase B — campaign core:** migration 2, `campaign-engine.ts` (fire + deliver + close), the
   schedule self-check script, scheduler wiring under `SystemLock`.
3. **Phase C — campaign surface:** campaigns API (CRUD + activate/pause/runs/preview), campaigns
   page (list + wizard + run log), nav item.
4. **Phase D — close out:** PRD gains a Campaigns section (the requirement now lives there per the
   discussion-doc convention), `Changelogs.md` 3.0.0, plan status table completed.

Phases A and B are independent and can land in either order; C depends on both.

---

## 7. Explicitly out of scope (v1)

- Opt-out handling (round 1: the manual flag was dropped; Meta marketing templates carry their own
  opt-out button). Auto-detecting "STOP"/"berhenti" replies is a possible v2.
- Real media upload/storage — v1 images come from a public URL pasted by the owner (round 1, 3.2.1).
- In-window interactive buttons (Cloud API free-form buttons) — buttons reach a blast via META
  templates only in v1.
- Campaign analytics beyond run counts (opens, clicks — not available on WhatsApp anyway).
- A/B testing, per-recipient variable interpolation beyond a name token, drip sequences
  (multi-step campaigns) — one message per fire is the v1 unit.
- Sending campaigns through any channel other than the tenant's own connected WhatsApp channels.
- Public API access to campaigns.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Owner builds a free-form campaign and most recipients get skipped on Cloud API | Hard warning in the wizard before save + per-recipient `SKIPPED` reasons visible in the run log |
| Meta tier limit hits mid-blast | Audience-size warning before save; per-recipient FAILED rows; blast continues |
| Blast marked as spam by recipients | Opt-out handling lives in the Meta marketing template (set in Meta Manager) on Cloud API; on Baileys the owner manages opt-outs manually; pacing keeps volume low |
| A paused campaign's in-flight messages vanish | PENDING rows persist and resume on activate — nothing is deleted |
| Process restart mid-blast | Per-recipient rows + minute tick: the blast resumes exactly where it stopped (no double sends — PENDING claim is atomic) |
| Campaign traffic drowns the inbox | CAMPAIGN sender type is filterable; campaign sends never trigger the AI agent |

---

## 9. Round 1 discussion record (2026-11-01)

The owner asked four things; answers and corrections are folded into the sections above. Recorded
here because the reasoning matters more than the conclusion.

1. **"Do we really need a Meta-approved template? I meant our internal template."**
   Answered: the two are different things (3.2). On Baileys, internal templates / free text reach
   everyone, always — no Meta templates ever. On the Cloud API (the live channel today), free text
   only reaches customers who messaged within the last 24h; beyond that Meta's server rejects it
   and only an approved template passes. Proof shown from this system's own production `AuditLog`
   (`conversation.agent_send_skipped_window` entries) and the existing enforcement in
   `agent-outbox.ts`. Meta approval is a free one-time submission, so the campaign carries both
   forms and the form warns in plain language.
2. **"The message can be image, text and custom buttons."**
   Answered with the per-channel matrix (3.2.1): image+caption is free in-window on Cloud API and
   free on Baileys (public URL, no upload infra); buttons outside the window exist only inside
   approved templates (designed in Meta Manager); free-form buttons are Cloud-API-in-window
   interactive messages (deferred to v2); Baileys cannot realistically offer buttons.
3. **Answers to the six decisions:** multi-category + multi-tag (accepted, schema now two symmetric
   joins); tags/categories shown in the conversation panel (accepted); "owner-only" was not
   understood — explained and re-asked as open decision 3; manual opt-out dropped (accepted);
   the 24h-window question resolved by the explanation above; recurring audience confirmed
   (fresh resolution per fire for segments, fixed list for MANUAL).

