# Feature Plan — Contact Tags & Categories + Campaigns (Message Blasting)

**Date:** 2026-11-01
**Status:** **IMPLEMENTED on `feat/contact-tags-and-campaigns`** (`6787ba8` Phase A,
`2b50de4` Phase B, `df71623` Phase C) — awaiting merge to `main`. All decisions closed after owner
rounds 1–3; WhatsApp pricing/limits verified against Meta's live docs (round 3, section 11).
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

**What the customer actually sees:** a Meta-approved template arrives on the customer's phone as
a normal WhatsApp message from the business — its text (with `{{name}}`-style variables filled),
its image, its buttons. Nothing marks it as a template. "Template" only names the one-time
pre-approval step on the business side; the delivery is an ordinary message. What Meta's server
refuses is the opposite case: text typed at send time (from the internal template library or fresh)
to a customer silent >24h — Meta cannot pre-check free text, so it blocks it. Customers never see
the difference; the difference is only which messages Meta lets through to inactive customers.

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
4. **Cost is per delivered message (verified against Meta's pricing page, Oct 2026).**
   - Effective July 1, 2025, WhatsApp bills **per message**, not per conversation: rates are per
     market×category, charged only for messages Meta *delivered*.
   - Effective **October 1, 2026**, Meta resumed charging for messages that were previously free:
     **service replies inside the 24h window** and in-window utility templates. Each business
     phone number gets **1,000 free service messages per month** (no rollover), then they bill.
     A free-form blast burns that allowance fast — campaigns are real money on the Cloud API now.
   - Messages that start from a **Click-to-WhatsApp ad** open a free entry point window (up to
     7 days): everything inside it is free. Relevant for UMKM running FB/IG ads.
   - The create form shows the resolved audience count with a cost note pointing at Meta's
     published rate card; v1 does not compute per-recipient prices (rates change quarterly).
5. **Messaging limits cap business-initiated sends (verified, Oct 2026):** the maximum number of
   unique recipients a business can message **outside the 24h window** per moving 24h. New
   portfolios start at **250** and scale to **2,000** (business verification, or 2,000 delivered
   template messages in a 30-day window at high quality rating), then automatically
   10,000 → 100,000 → unlimited. This caps *template* blasts specifically — in-window service
   sends do not count against it. The create form warns when the audience exceeds the current
   limit (visible in WhatsApp Manager).
6. **Platform behaviors the engine leans on / documents (verified):**
   - **Media caching:** the Cloud API caches link-based media for 10 minutes — every campaign
     recipient reuses the same `/api/media/[id]` URL, so Meta fetches the image once per blast.
   - **Burst order is not guaranteed:** for a series of messages (text then images) WhatsApp
     does not guarantee delivery order. Guaranteed order requires webhook-confirmed sequencing —
     overkill for v1; the wizard notes best-effort ordering ("foto menyusul").
   - **Opt-in + quality rating:** Meta's policy requires recipients to have opted in; blasting
     non-opted-in contacts degrades the number's quality rating, which is exactly what gates the
     messaging-limit scaling above.

### 3.2.1 Rich content: text, uploaded images, buttons (owner rounds 1–2)

Requested: a campaign message can be image + text + buttons, with **uploaded** images (not URLs),
possibly several. Two platform facts shape it:

1. **One image per WhatsApp message.** WhatsApp media messages carry a single image (Cloud API
   image limit: 5 MB, jpeg/png/webp). Multiple images = the campaign sends them as a short burst
   of consecutive messages to each contact — exactly like a person sending several photos. The
   pacing delay applies between CONTACTS, not within one contact's burst.
2. **Where a burst can go:** free-form images reach customers **inside the 24h window** on the
   Cloud API and **everyone** on Baileys. Outside the window on the Cloud API only the approved
   template path exists — and a Meta template carries exactly **one** header image. Buttons
   likewise live inside approved templates (in-window interactive buttons are a Cloud-API-only
   v2 idea; Baileys cannot offer them reliably).

| Content | Cloud API, inside 24h | Cloud API, outside 24h | Baileys |
|---|---|---|---|
| Text | free | template only | free |
| Images (uploaded, 1–4) | burst of media messages, free | **template only, single header image** | burst of media messages, free |
| Buttons | interactive message (no approval) — v2 | only inside an approved template | not offered |

**Image storage (round 2 decision — upload, not URL):** the app has no S3 and the container disk
is wiped on every deploy, so v1 stores campaign images **in Postgres** and serves them from the
app's own HTTPS domain:

```prisma
model MediaAsset {
  id        String   @id @default(uuid())   // unguessable — the only access control
  tenantId  String
  mimeType  String                        // image/jpeg | image/png | image/webp
  byteSize  Int                           // ≤ 5 MB enforced at upload
  data      Bytes                        // postgres bytea
  createdAt DateTime @default(now())
  @@index([tenantId, createdAt])
}
```

- Upload: `POST /api/dashboard/media` reads the raw request body as bytes (`bodyParser: false`,
  same streaming pattern as the WhatsApp webhook; no multipart parser, no new dependency) with
  `?filename=` metadata. Hard caps: 5 MB per image, 4 images per campaign message, mime allow-list.
- Serving: `GET /api/media/[id]` is **public, long-cache (`immutable`), no session** — Meta's fetcher
  must reach it over HTTPS, and the campaign send passes
  `https://<app-domain>/api/media/<id>` as the Cloud API image `link`. The app domain comes from the
  request origin. Security: UUID ids are unguessable, content is tenant promo imagery, rows are
  immutable — an unauthenticated GET is the same trust level as a public marketing image anywhere.
  Baileys downloads the same bytes in-process and sends them as a buffer with the caption.
- No delete in v1 (a campaign references the asset by id; orphaned uploads cost a few MB in
  Postgres — a cleanup pass is noted for later).

**Campaign content snapshot** therefore carries an ordered image list:

```prisma
  // in Campaign:
  imageIds  String[]   // ordered MediaAsset ids, 0–4; sent as a burst after the text
```

Send order per recipient (free-form path): the text message first (if non-empty), then each image
as its own media message, back-to-back; every item recorded as its own OUTBOUND `Message` row
attributed to the run. Template path: one template send (its own header image/buttons, as designed
in Meta Manager) — no burst.

### 3.3 Decisions (recommendations in bold)

| # | Decision | Status after owner round 2 (2026-11-01) |
|---|---|---|
| 2.1 | Recurring audience | **CONFIRMED by owner** — every fire sends to everyone matching the audience at that moment (category/tag audiences include customers tagged after the campaign was created; MANUAL selection stays a fixed list) |
| 2.2 | Permissions | **CONFIRMED (round 2):** OWNER always; STAFF may create/pause campaigns **iff the owner grants it**. There is no permission system today (two hardcoded roles, Team page can only invite), so v1 adds a single per-staff toggle: `User.canRunCampaigns` (default false), set from the Team page. A full permission matrix stays out of scope |
| 2.3 | Sender identity in the inbox | **New `MessageSenderType.CAMPAIGN`** (not reusing SCENARIO), so campaign sends are distinguishable in the inbox and audit |
| 2.4 | Does the AI answer replies? | **Yes — unchanged plumbing:** a reply is a normal inbound; the turn lease/drain handles it. Campaign sends deliberately do NOT count as "answered" for the drain (same exclusion as SCENARIO) |
| 2.5 | Pacing accuracy | **Best-effort with 1-minute scheduler granularity** (a 10s delay sends ~6/min; a crash resumes exactly where the per-recipient rows left off) |
| 2.6 | Marketing opt-out | **DROPPED by owner.** Meta's marketing templates carry their own opt-out button set in Meta Manager — nothing needed in our code |
| 2.7 | Schedule timezone | **Reuse `SCENARIO_SCHEDULE_TZ`** (already documented, default Asia/Jakarta) |
| 2.8 | Channel selection | **CONFIRMED (round 2): both channels**, chosen per campaign (`channelId`); the form lists CONNECTED channels and the wizard shows the send matrix so the owner knows which recipients a free-form blast can reach |
| 2.9 | Menu placement | **"Kampanye" in the Utama group** of the sidebar |
| 2.10 | Rich content | **CONFIRMED (round 2): uploaded images (Postgres-stored, served from the app domain), multiple images as a burst (3.2.1), text, buttons via META templates.** Round-1 URL idea dropped in favor of real upload |
| 2.11 | Out-of-window send policy | **CONFIRMED (round 3, owner):** Cloud API — anything that requires a template (i.e. reaching a recipient whose 24h window is closed) goes as an **approved META template**, per the send matrix in 3.2; Baileys — internal template content only, sent as normal messages, no Meta templates involved anywhere |

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
  imageIds     String[]                      // ordered MediaAsset ids, 0-4 (round 2, 3.2.1)
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
categories (OR semantics). `marketingOptOut` was dropped by the owner (decision 2.6). Round 2 adds:
`MediaAsset` (3.2.1), `Campaign.imageIds`, and `User.canRunCampaigns Boolean @default(false)` —
the per-staff toggle the owner sets from the Team page (decision 2.2); the auth session must carry
it (jwt + session callbacks + the next-auth type augmentation).

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
     Baileys always sends `body`). Free-form sends are a **burst**: the text message (if non-empty)
     then each image as its own media message (3.2.1) — the pacing delay applies between contacts,
     not within a contact's burst. Template sends are one template call.
   - Record an `OUTBOUND` Message row per burst item (`senderType: CAMPAIGN`, `kind: TEXT`), stamp
     the conversation `lastMessageAt`, update the recipient row (`SENT`/`FAILED`/`SKIPPED` +
     reason + `waMessageId`). A recipient error never aborts the batch; a partial burst (text sent,
     image 2 failed) records the failed item's error on the recipient row and still counts the
     contact as reached-with-errors.
3. **Close finished runs:** runs with no `PENDING` left get `finishedAt` + counts.
4. **Audit:** one row per lifecycle event (`campaign.create/update/activate/pause/delete`,
   `campaign.fire` with the audience counts) — per-recipient traceability lives in
   `CampaignMessage`, so a 500-recipient blast does not create 500 audit rows.

Idempotency: a redelivered tick cannot double-send — the tick runs under the `SystemLock` lease and
each row flips PENDING→sent-atomically via `updateMany where status=PENDING` before sending.

### 3.6 API

| Route | Method | Notes |
|---|---|---|
| `/api/dashboard/campaigns` | GET, POST | POST validates the audience references and resolves the content snapshot (template → body/metaName). Allowed for OWNER, or STAFF with `canRunCampaigns` |
| `/api/dashboard/campaigns/[id]` | GET, PUT, DELETE | PUT only while DRAFT or PAUSED (an ACTIVE campaign is paused first — never edited live) |
| `/api/dashboard/campaigns/[id]/activate` | POST | DRAFT/PAUSED → ACTIVE; computes the first `nextRunAt` |
| `/api/dashboard/campaigns/[id]/pause` | POST | ACTIVE → PAUSED (in-flight PENDING rows stay PENDING and resume on activate) |
| `/api/dashboard/campaigns/[id]/runs` | GET | run list with counts; `?runId=` returns that run's message log (paged) |
| `/api/dashboard/campaigns/preview` | POST | audience resolution preview: `{total, byCategory}` — powers the form's live count |
| `/api/dashboard/media` | POST | image upload, raw-bytes body (`bodyParser: false`, streamed, 5 MB cap, mime allow-list); same campaign permission as above. Returns the `MediaAsset` id |
| `/api/media/[id]` | GET | **public, unauthenticated, immutable cache** — serves the bytes so Meta's fetcher can reach the image (3.2.1) |
| `/api/dashboard/team/[id]` | PUT | OWNER-only: toggles a STAFF member's `canRunCampaigns` |

All Zod-validated (media route validates bytes/mime/size), tenant-scoped, audited.

### 3.7 UI (`/dashboard/campaigns`)

- **List page:** status cards (total, ACTIVE, messages sent this month from run counts), a table of
  campaigns (name, audience summary, schedule summary, next run (id-ID), status badge, actions:
  edit / pause-activate / delete with ConfirmDialog), and an expandable run history per campaign
  (per-run counts + a paged message log with statuses and skip reasons).
- **Create/edit wizard dialog** (steps mirroring the owner's mental model):
  1. **Nama & saluran** — name + channel picker (CONNECTED channels only).
  2. **Penerima** — audience: Semua / Kategori (multi-select, OR) / Tag (multi) / Pilih manual
     (contact picker); live preview count from `/preview`, the Meta tier warning.
  3. **Pesan** — from the tenant template library (CSQ or META) or write fresh; an **image upload
     widget** (select files, POST to `/api/dashboard/media`, thumbnails from `/api/media/[id]`,
     max 4, 5 MB each); body preview with the 24h-window warning when the message is free-form on
     a Cloud API channel; when a META template is chosen, a note that the template's own image and
     buttons were designed in Meta Manager (campaign images do not ride inside templates).
  4. **Jadwal & tempo** — schedule kind + time (and weekday/day-of-month/every-N-days as
     applicable), delay seconds (min 10s, default 30s), summary line: "± 120 kontak × 30 dtk ≈
     60 menit per kirim".
- Reuses `DashboardShell`, the existing Dialog/Badge/Table components, and the Tag page's chip
  styling; one new nav item in `NAV_GROUPS` (decision 2.9).
- Contact panel (Feature 1) shows tags + categories with OWNER/permission edit affordances.
- **Team page:** a "Boleh jalankan kampanye" toggle per STAFF row (OWNER-only) — the round-2
  permission design (3.3 #2.2).

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
| 2 | `20261101020000_campaigns_media` | 5 enums (`MessageSenderType` gains `CAMPAIGN`), `Campaign`, `CampaignRun`, `CampaignMessage`, `MediaAsset` (bytea), `User.canRunCampaigns`; indexes; RLS policies for the new tenant tables (`MediaAsset` included; `User` already has a policy — the new column rides on it) |

Additive only; applied to Neon over MCP with `_prisma_migrations` bookkeeping (checksums via
`npm run db:migration-checksums`), the workflow established in the 2.0.0 fixes.

---

## 5. Open decisions — CLOSED (round 2, 2026-11-01)

All decisions are answered. Round 1 settled: multi-category/multi-tag contacts, shared tag
taxonomy, tags/categories in the conversation panel, fresh audience resolution per fire, opt-out
dropped. Round 2 settled the rest:

| # | Question | Owner's answer |
|---|---|---|
| 1 | Which channel carries campaigns? | **Both** — per-campaign choice (`channelId`), wizard shows the send matrix |
| 2 | Rich content scope | **Uploaded images (not URLs), multiple images as a burst** — Postgres-stored `MediaAsset`, served from the app domain (3.2.1); buttons via META templates |
| 3 | May STAFF run campaigns? | **Yes, when the owner grants it** — new per-staff `canRunCampaigns` toggle on the Team page (the app has no permission system today, so this single toggle is the v1 of one) |
| 4 | Tags/categories in the inbox panel | **Editable** there |

Round 3 settled the last one: on the Cloud API, anything needing a template (recipients outside
the 24h window) uses an approved META template; on Baileys, internal template content is sent as
normal messages — decision 2.11. The plan is fully decided.

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

- In-window interactive buttons (Cloud API free-form buttons) — buttons reach a blast via META
  templates only in v1.
- Media deletion/cleanup — uploads are immutable and kept (a few MB each; a cleanup pass noted
  for later).
- A general permission matrix — v1 gets the single per-staff campaign toggle only.
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
| Media bytes bloat the database | 5 MB/4-image caps, mime allow-list, immutable storage; Neon's logical limit is far away at UMKM volume; cleanup pass noted for later |
| Public media route leaks images | UUID ids are unguessable, content is tenant promo imagery, rows immutable — same trust level as any hosted marketing image |
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

## 10. Round 2 discussion record (2026-11-01)

1. **"We send it as a message, not a template."** Confirmed the owner's instinct about the
   *experience* and corrected the mechanism (now documented at the top of 3.2): a Meta-approved
   template is delivered to the customer as a completely normal WhatsApp message — text with
   variables filled, image, buttons — nothing marks it as a template. "Template" only names the
   one-time pre-approval on the business side. What Meta refuses is text typed at send time going
   to customers silent >24h — free text cannot be pre-checked, so only pre-approved content reaches
   them.
2. **Channel: both.** Each campaign picks its channel; the wizard shows the send matrix so the
   owner knows who a free-form blast can reach on each.
3. **Images: upload, multiple.** Two platform facts recorded in 3.2.1 — one image per WhatsApp
   message (multi-image = a burst of consecutive messages; 5 MB, jpeg/png/webp caps) and
   burst-images only reach customers inside the 24h window on Cloud API (an approved template
   carries exactly one header image). Storage: the app has no S3 and the deploy disk is wiped, so
   v1 stores bytes in Postgres (`MediaAsset.data bytea`) and serves them from the app's own HTTPS
   domain via a public, immutable-cache route that Meta fetches. Round-1 "paste a URL" idea dropped.
4. **Permissions: staff + owner.** The owner assumed a configurable permission system exists — it
   does not (two hardcoded roles; Team page only invites). v1 adds the single honest piece:
   `User.canRunCampaigns`, a per-staff toggle on the Team page, set by the owner. A full permission
   matrix is out of scope.
5. **Inbox panel: editable** tags/categories there.

With those, every open decision is closed and the plan is approved for implementation.

## 11. Round 3 — verification against Meta's live documentation (2026-11-01)

The owner challenged the 24h-window claim and reported that WhatsApp moved to per-bubble
("per message") pricing on October 1, 2026. Both claims were checked against Meta's own current
pages (developers.facebook.com — *Pricing on the WhatsApp Business Platform*, *Service messages*,
*Messaging limits*), which already reflect the October 1, 2026 updates:

- **The owner was right about pricing, and an earlier note in this discussion was outdated.**
  Billing is per delivered message (since July 1, 2025), and as of **October 1, 2026** Meta
  resumed charging for messages that were previously free: service replies inside the 24h window
  and in-window utility templates, with 1,000 free service messages per phone number per month.
  "Free-form replies inside the window are free" stopped being true 31 days before this plan was
  written. Plan updated (3.2, consequence 4).
- **The 24h window is NOT a pricing rule — it is a message-type rule, and it is unchanged.**
  Meta's current wording, verbatim:
  - "*Non-template messages (`\"type\":\"text\"`, `\"type\":\"image\"`, and so on) can only be
    sent in an open 24-hour customer service window … non-template messages cannot be used to
    reach out to users.*" (Pricing, Non-template messages)
  - "*If it is not open, businesses can only send template messages to reach out to users.*"
    (Pricing, Customer service window)
  - "*When the window closes, you can only send pre-approved template messages.*"
    (Service messages)
  Pricing decides what each delivered message **costs**; the window decides which message
  **types may be sent at all**. After 24h a free-form bubble is rejected by Meta's API
  (error 131047) — it is not merely billed differently.
- **Messaging limits corrected in this plan:** new portfolios start at 250 unique out-of-window
  recipients per moving 24h, scaling to 2,000 / 10,000 / 100,000 / unlimited (an earlier draft
  said "1k once verified" — wrong tier). This caps template blasts specifically.
- **Two engine-relevant platform behaviors recorded:** the Cloud API caches link-based media for
  10 minutes (favorable — every campaign recipient reuses the same `/api/media/[id]` URL), and
  delivery order for a multi-message burst is not guaranteed (best-effort ordering documented).

**Round 3 close — the owner's decision (2.11):** for the official Cloud API channel, everything
that requires a template (i.e. reaching a recipient outside the 24h window) is sent as an
approved META template; for Baileys, the campaign uses internal template content sent as normal
messages. That closes the last open question — the plan is fully decided and ready to build.

---

## 12. Implementation status (2026-11-01)

Built on branch `feat/contact-tags-and-campaigns`, pushed to origin. All three phases landed with
`npm run build` green, `npm run check:encoding` green (236 files), migrations applied to Neon over
MCP with matching `_prisma_migrations` bookkeeping, and RLS coverage re-verified
(33/33 tenant tables after Phase A, 37/37 after Phase B).

| Phase | Commit | What landed |
|---|---|---|
| A — contact classification | `6787ba8` | `Category` + `ContactCategory`/`ContactTag` joins (multi-category, multi-tag per contact); category CRUD; contacts list filters (`categoryId`/`tagId`) + classification includes; contact PUT with replace-set inside a transaction (unknown ids → 400); contacts page chip columns + filters + multi-select edit; "Kategori Kontak" section on the Tag page; category/tag chips + editors in the inbox contact panel |
| B — campaign core | `2b50de4` | Campaign/CampaignRun/CampaignMessage/MediaAsset + `User.canRunCampaigns` + `MessageSenderType.CAMPAIGN`; `campaign-engine.ts` (fire → paced per-recipient rows → deliver → close) under `withSystemLock("campaign-tick", 300s)` in the existing minute tick; pure schedule math (`campaign-schedule.ts`, Intl-based, no date library) with a 13/13 self-check (`scripts/self-check-campaign-schedule.ts`); `sendImage` on both providers (Cloud API link, Baileys bytes); media bytes cached per tick; `canRunCampaigns` in the auth session |
| C — campaign surface | `df71623` | Campaigns API (create with content snapshot, edit DRAFT/PAUSED only, activate/pause, runs + per-recipient logs, audience preview); raw-bytes media upload (streamed, 5 MB, JPEG/PNG/WebP) + public immutable-cache serve route; Team page permission toggle (OWNER-only, staff-only); the Kampanye wizard page (4 steps, live audience count, image upload, run history with skip reasons) + nav item |

Verification performed: build + lint + encoding after every phase; the schedule self-check; live-SQL
migration checks on Neon (tables, columns, indexes, policies, `MessageSenderType` gains
`CAMPAIGN`). **Not yet exercised with live WhatsApp traffic** — the same open item as the 2.0.0
fixes: the first real campaign should be watched in the run history (statuses + skip reasons) and
the AuditLog (`campaign.fire`).

Deviations from the plan, all minor:

- Campaign activate/pause share one route file (`[id]/[action].ts`) instead of two — one permission
  block, half the surface.
- The team list API reports `canRunCampaigns: true` for the OWNER row (access comes from the role;
  the toggle only appears on STAFF rows).
- Contact edit stays OWNER-only as before; STAFF may tag **conversations** but not reclassify
  contacts in v1 (widening is a one-line decision later).

