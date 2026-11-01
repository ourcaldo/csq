# Feature Plan — Contact Tags & Categories + Campaigns (Message Blasting)

**Date:** 2026-11-01
**Status:** Proposed — awaiting approval of the open decisions in section 5
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

| # | Decision | Options |
|---|---|---|
| 1.1 | Category multiplicity | **One category per contact** (a classification — multiple groups is what tags are for) vs many-to-many |
| 1.2 | Tag taxonomy | **Share the existing `Tag` model** with conversations via a new `ContactTag` join — one list to manage, one color system, tags become reusable across contact + conversation |
| 1.3 | Who may tag/categorize | **OWNER** (matches the existing OWNER-only `PUT /contacts/[id]`); STAFF tagging listed as a follow-up decision |
| 1.4 | Category management UI | **A "Kategori Kontak" section on the existing Tag page** (one taxonomy screen) rather than a new menu item |

### 2.3 Schema (one migration)

```prisma
model ContactCategory {
  id        String   @id @default(uuid())
  tenantId  String
  name      String
  color     String?          // same normalize/random hex pattern as Tag
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  contacts  Contact[]
  @@unique([tenantId, name])   // stable names — campaigns reference them by id
}

model Contact {
  // existing fields...
  categoryId String?
  category   ContactCategory? @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  tags       ContactTag[]
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
```

Tag gains a `contactTags ContactTag[]` relation. RLS: the coverage rule from D9 applies — the new
`ContactTag`/`ContactCategory` tables carry `tenantId` and the migration adds their policies.

### 2.4 API

| Route | Method | Notes |
|---|---|---|
| `/api/dashboard/contact-categories` | GET, POST | OWNER for POST; POST upserts by name so the same category cannot duplicate |
| `/api/dashboard/contact-categories/[id]` | PUT, DELETE | DELETE sets `Contact.categoryId` to null (SetNull), never deletes contacts |
| `/api/dashboard/contacts` | GET | include `category` + `tags`; new filters `?categoryId=`, `?tagId=` (multi-tag = OR within the set, AND across tag+category) |
| `/api/dashboard/contacts/[id]` | PUT | `contactUpdateSchema` gains optional `categoryId` and `tagIds: string[]` (replace-set semantics, all-or-nothing validation: unknown ids → 400) |

Zod at every boundary; every query tenant-scoped; mutations audited (`contact.update` before/after
now includes the classification).

### 2.5 UI

- **Contacts page:** two new columns (category chip, tag chips), a filter bar (category select +
  tag select), and the edit dialog gains a category select + tag multi-select (reuse the Tag page's
  chip/color rendering; a small inline "create tag" affordance on OWNER).
- **Tag page:** second section "Kategori Kontak" (same table + dialog pattern as tags).
- **Inbox contact panel (`contact-details.tsx`):** read-only category + tag chips under the contact
  name, with an OWNER edit affordance reusing the same dialog.

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

### 3.2 THE constraint: the 24h window decides what can actually be sent

This is the single most important design fact, verified in `agent-outbox.ts`/`scenario-engine.ts`:

> On the **Cloud API**, a business may send free-form text only inside the 24h customer-service
> window of each recipient. A blast is business-initiated: for most recipients that window is
> closed, and the only legal content is a **pre-approved META template**. On **Baileys** there is
> no window, but the provider's `sendTemplate` sends the template NAME as text — so a campaign must
> always carry a body for Baileys.

Send policy per campaign message:

| Channel | Recipient window | `body` (free-form / CSQ template) | `META` template |
|---|---|---|---|
| Cloud API | open (<24h since last inbound) | send free-form | send template |
| Cloud API | closed | **SKIPPED + reason `window_closed`** (Meta rejects free-form) | send template |
| Baileys | n/a | send body | **send the snapshot body** (never the template name) |

Consequences built into the plan:

1. A campaign saves a **content snapshot** at creation time: `body` (resolved from a CSQ template or
   typed fresh) and, if a META template was chosen, `metaName`/`metaLanguage` too. Editing a
   template later must not silently change a scheduled campaign.
2. The create form **must** require a body even when a META template is chosen (it is the Baileys
   text and the preview), and **must warn** when a free-form-only campaign runs on a Cloud API
   channel: "hanya pelanggan yang chat <24 jam terakhir yang bisa menerima pesan bebas; sisanya
   akan dilewati. Pakai template META untuk menjangkau semua."
3. Recipients whose window is closed are recorded `SKIPPED` with a reason — never a silent drop,
   never a send Meta would reject.
4. **Meta volume limits:** business-initiated messages per 24h are tier-limited (250 for an
   unverified number, 1k once verified). The create form shows the resolved audience size and a
   plain-language warning when it exceeds the likely tier. Per-recipient provider failures become
   `FAILED` rows and the blast continues.

### 3.3 Decisions (recommendations in bold)

| # | Decision | Options |
|---|---|---|
| 2.1 | Recurring audience | **Resolved fresh at every fire** for ALL/CATEGORY/TAGS (new customers get included; that is the point of segments). MANUAL selection is the only snapshot mode. |
| 2.2 | Permissions | **OWNER-only** for create/edit/activate/pause/delete; the list and run logs are OWNER-only too (blasting reaches every customer — it is configuration, not inbox work) |
| 2.3 | Sender identity in the inbox | **New `MessageSenderType.CAMPAIGN`** (not reusing SCENARIO), so campaign sends are distinguishable from scenario sends in the inbox and audit |
| 2.4 | Does the AI answer replies? | **Yes — unchanged plumbing:** a reply is a normal inbound; the turn lease/drain handles it. Campaign sends deliberately do NOT count as "answered" for the drain (same exclusion as SCENARIO), so a pending customer question is never suppressed by a blast. |
| 2.5 | Pacing accuracy | **Best-effort with 1-minute scheduler granularity** (a 10s delay sends ~6/min; a crash resumes exactly where the per-recipient rows left off). Exact sub-minute spacing is not promised. |
| 2.6 | Marketing opt-out | **v1: manual `marketingOptOut` flag per contact** (excluded from every audience, shown in the contact panel). Auto-detecting "STOP" replies is a documented follow-up. This exists because Meta's marketing policy requires an opt-out path. |
| 2.7 | Schedule timezone | **Reuse `SCENARIO_SCHEDULE_TZ`** (already documented, default Asia/Jakarta) rather than a second env var |
| 2.8 | Channel selection | Campaign stores `channelId`; the form lists CONNECTED channels (most tenants have one). Default: the connected Cloud API channel, or the only connected channel. |
| 2.9 | Menu placement | **"Kampanye" in the Utama group** of the sidebar (customer-facing comms, next to Percakapan/Template) |

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
  categoryId   String?                      // CATEGORY mode
  tagIds       String[]                     // TAGS mode (OR)
  contactIds   String[]                      // MANUAL mode (snapshot)
  // Content snapshot (resolved at save time — later template edits never
  // silently change a scheduled campaign)
  sendKind     CampaignSendKind
  body         String                        // free-form / CSQ body; also the Baileys text
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

Also: `Contact.marketingOptOut Boolean @default(false)` (decision 2.6).

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
| `/api/dashboard/campaigns/preview` | POST | audience resolution preview: `{total, optOutExcluded, byCategory?}` — powers the form's live count |

All OWNER-only, Zod-validated, tenant-scoped, audited.

### 3.7 UI (`/dashboard/campaigns`)

- **List page:** status cards (total, ACTIVE, messages sent this month from run counts), a table of
  campaigns (name, audience summary, schedule summary, next run (id-ID), status badge, actions:
  edit / pause-activate / delete with ConfirmDialog), and an expandable run history per campaign
  (per-run counts + a paged message log with statuses and skip reasons).
- **Create/edit wizard dialog** (steps mirroring the owner's mental model):
  1. **Nama & saluran** — name + channel picker (CONNECTED channels only).
  2. **Penerima** — audience: Semua / Kategori (select) / Tag (multi) / Pilih manual (contact
     picker); live preview count from `/preview`, the Meta tier warning, and the opt-out note.
  3. **Pesan** — from the tenant template library (CSQ or META) or write fresh; body preview with
     the 24h-window warning when the message is free-form on a Cloud API channel.
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
| 1 | `20261101010000_contact_categories` | `ContactCategory`, `ContactTag`, `Contact.categoryId`, `Contact.marketingOptOut`, relations; RLS policies for the two new tenant tables (the D9 coverage rule — verified 30/30 today, becomes 32/32) |
| 2 | `20261101020000_campaigns` | 5 enums (`MessageSenderType` gains `CAMPAIGN`), `Campaign`, `CampaignRun`, `CampaignMessage`, indexes; RLS policies for the three new tenant tables |

Additive only; applied to Neon over MCP with `_prisma_migrations` bookkeeping (checksums via
`npm run db:migration-checksums`), the workflow established in the 2.0.0 fixes.

---

## 5. Open decisions to confirm

| # | Question | Recommended |
|---|---|---|
| 1 | One category per contact (2.2 #1.1)? | Yes — multiple groupings is what tags are for |
| 2 | Share the existing tag list with conversations (2.2 #1.2)? | Yes — one taxonomy, one management page |
| 3 | Campaigns OWNER-only (3.3 #2.2)? | Yes |
| 4 | Marketing opt-out flag included in v1 (3.3 #2.6)? | Yes — it is one column + one filter, and Meta's marketing policy expects an opt-out path |
| 5 | Free-form campaigns on Cloud API: skip out-of-window recipients with a logged reason (3.2)? | Yes — the compliant alternative does not exist |
| 6 | Recurring audiences resolved fresh at each fire (3.3 #2.1)? | Yes |

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

- Auto-detecting opt-out replies ("STOP", "berhenti") — flag exists, detection is a follow-up.
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
| Blast marked as spam by recipients | Opt-out flag excluded from audiences; opt-out note in the wizard; pacing keeps volume low |
| A paused campaign's in-flight messages vanish | PENDING rows persist and resume on activate — nothing is deleted |
| Process restart mid-blast | Per-recipient rows + minute tick: the blast resumes exactly where it stopped (no double sends — PENDING claim is atomic) |
| Campaign traffic drowns the inbox | CAMPAIGN sender type is filterable; campaign sends never trigger the AI agent |
