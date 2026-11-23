# 29 - Tenant Custom Roles & Channel Access Control

Status: proposed 2026-11-23. Owner request: tenants must be able to create
their own roles and rules (beyond the platform defaults), and the owner must
be able to set which staff/roles can access which channel - including which
roles may add, edit, and/or delete channels.

Related: PRD 16 SEC-3 (role gates), PRD 28 Part A (channel selection UX),
PRD 17 (staff KPI), the team/invite system (PRD 16 FEA-5).

## 1. Problem

Today the tenant realm has exactly two roles, hard-coded as a Prisma enum:
OWNER and STAFF. Every BFF route gates with `requireRole(session, "OWNER")`
or `requireRole(session, "OWNER", "STAFF")` - about 100 call sites. The only
per-user nuance is the `canRunCampaigns` boolean. There is no way for a
tenant to:

1. Create intermediate roles ("admin chat", "kasir", "admin data",
   "marketing") with their own permission sets.
2. Say which staff member may see and reply on WHICH WhatsApp channel. All
   STAFF see every conversation on every channel today; the only scoping is
   the Ditugaskan tab (staff see their own assigned chats there).

The owner's target scenario: 3 chat admins, each bound to a different
channel - admin A only touches channel 1's conversations, admin B channel 2,
and so on.

## 2. Concepts

- **Permission** (aturan): a named capability key, defined once in code,
  e.g. `inbox.balas`, `produk.kelola`, `saluran.hapus`. The catalog is fixed
  per release; tenants choose which keys a role has.
- **Role** (peran): a tenant-scoped named bundle of permissions. Seeded
  defaults from the platform; tenants create their own.
- **Channel access** (akses saluran): per-channel grants that say which
  user and/or role may LIHAT (view the channel's conversations),
  KIRIM/BALAS (compose), and KELOLA (manage the channel). Plus the
  role-level channel CRUD permissions: `saluran.tambah`, `saluran.ubah`,
  `saluran.hapus` (who may add, edit, delete channels at all).

## 3. Permission catalog (v1)

Derived from the existing requireRole gates so nothing regresses. Grouped
for the UI; the key is the code identifier. `lihat` = read access to the
page/data, `kelola` = create/edit/delete within it.

| Group | Keys |
|---|---|
| Percakapan | `inbox.lihat`, `inbox.balas`, `inbox.tugaskan`, `inbox.catatan`, `inbox.tag`, `inbox.template_kirim`, `inbox.media` |
| Pipeline | `pipeline.lihat`, `pipeline.kelola` |
| Kampanye | `kampanye.lihat`, `kampanye.kelola` (replaces `canRunCampaigns`) |
| Template Pesan | `template.lihat`, `template.kelola` |
| Data Bisnis | `produk.lihat`, `produk.kelola`, `inventaris.lihat`, `inventaris.kelola`, `pesanan.lihat`, `pesanan.kelola`, `kontak.lihat`, `kontak.kelola`, `tag.lihat`, `tag.kelola` |
| Pengetahuan | `pengetahuan.kelola`, `memori.lihat`, `memori.kelola`, `sumberdata.kelola`, `impor.kelola` (Excel/Sheets import + sync) |
| Agent & Otomasi | `agent.lihat`, `agent.kelola` (deploy/pause/capabilities), `skenario.lihat`, `skenario.kelola`, `approval.lihat`, `approval.putuskan`, `tiket.lihat`, `tiket.kelola` |
| Analitik | `kpi.lihat`, `aktivitas.lihat`, `audit.lihat` |
| Saluran | `saluran.lihat`, `saluran.tambah`, `saluran.ubah`, `saluran.hapus` |
| Pengaturan | `pengaturan.kelola` (umum/logo/auto-close/email), `pengaturan.tim`, `apikeys.kelola`, `webhook.lihat` |
| Peran | `peran.kelola` (create/edit roles, assign roles to users) |

Owner-only in v1 (NOT grantable): `peran.kelola`,
`pengaturan.tim`, `apikeys.kelola`, `audit.lihat`, `billing.lihat` (the
plan/quota page), `pengaturan.kelola`. These stay attached to the OWNER
account only. Revisit later if tenants ask for delegated admins.

Adding a permission to the catalog is a code change; the PRD constraint is
that every catalog key MUST map to at least one enforced gate (no dead
permissions).

## 4. Default roles (seeded per tenant, owned by the platform)

| Role | Description | Permissions |
|---|---|---|
| **Akses Penuh** | Everything except the owner-only list | All catalog keys minus the owner-only list |
| **Admin Chat** | Frontline chat operator - FULL powers on the conversation surfaces, not read-only (owner decision 2026-11-23) | `inbox.*` (all seven), `kontak.kelola`, `pipeline.kelola`, `tiket.kelola`, `template.kelola`, `aktivitas.lihat` |

Admin Chat's scope is then bounded by channel grants: an Admin Chat user
given only channel 1 has full inbox/kontak/pipeline/tiket/template powers
but only over channel 1's threads - per-channel access limits WHERE, role
permissions limit WHAT.

- Both are `isSystem: true` - tenants can duplicate them into editable
  copies, but not delete or rename the originals (support burden: the
  platform can reason about the defaults).
- The OWNER account is not a Role row; it is the account owner and always
  has every permission plus the owner-only list. It cannot be demoted,
  deleted, or reassigned (PRD 16 rule preserved).
- **Migration mapping**: existing STAFF users are assigned **Akses Penuh**
  so nobody loses access on upgrade; owners then trim roles down. The
  legacy `canRunCampaigns` boolean is migrated into the role
  (`kampanye.kelola`) and the column is retired.

### 4.1 Role presets - the Baca / Edit / Penuh radio (owner decision 2026-11-23)

The role editor opens with a three-option radio that PRE-FILLS the
permission matrix:

| Preset | Fills |
|---|---|
| **Baca saja** (read only) | every `lihat` key, nothing else |
| **Edit** | every `lihat` + `kelola` key |
| **Penuh** (full) | every non-owner-only key |

- The preset is a starting point, not a mode: the grouped permission
  matrix stays visible and editable beneath it. Changing a checkbox
  simply deselects the radio (the role becomes "kustom"). This keeps the
  3-click simple path AND the per-section granularity (e.g. kasir: full on
  pesanan, read-only on produk) in one editor.
- `permissions[]` remains the single source of truth - the radio only
  writes into it. No schema impact.

## 5. Data model

```prisma
model Role {
  id          String  @id @default(uuid())
  tenantId    String
  name        String
  description String?
  isSystem    Boolean @default(false)
  permissions String[]        // catalog keys; empty = no access
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  users       User[]

  @@unique([tenantId, name])
  @@index([tenantId])
}

model User {
  // role UserRole @default(OWNER)  ->  replaced by:
  isOwner    Boolean @default(false)  // the account owner; exactly one per tenant
  roleId     String?
  role       Role?  @relation(fields: [roleId], references: [id], onDelete: SetNull)
}

model ChannelAccess {
  id          String @id @default(uuid())
  tenantId    String
  channelId   String
  principal   String  @default("ROLE")  // "ROLE" | "USER"
  principalId String  // Role.id or User.id
  canView     Boolean @default(true)     // LIHAT: see the channel's conversations
  canCompose  Boolean @default(true)     // KIRIM/BALAS: send/reply on the channel
  canManage   Boolean @default(false)    // KELOLA: QR, test send, edit, disconnect

  channel Channel @relation(fields: [channelId], references: [id], onDelete: Cascade)
  @@unique([channelId, principal, principalId])
  @@index([tenantId])
}
```

```prisma
model Conversation {
  // Thread-per-channel (PRD 29 section 6.2, owner decision 2026-11-23):
  // the channel is part of the identity and immutable per thread.
  @@unique([tenantId, customerPhone, channelId])
}

model Deal {
  // One card per customer (PRD 29 section 6.3): uniqueness moves from the
  // conversation to the contact; conversationId stays as the pointer to
  // the customer's most recent active thread.
  contactId      String
  contact        Contact @relation(...)
  @@unique([tenantId, contactId])
}
```

- `isOwner` replaces the `UserRole` enum value OWNER; the enum is dropped.
  Enforced invariant: at least one `isOwner` user per tenant at all times
  (the existing last-owner guard moves onto the flag).
- A user with `roleId = null` and `isOwner = false` (possible only during
  migration edge cases) has NO permissions - fail closed.
- ChannelAccess rows are additive grants. No row = no grant. See the
  lockout rules in section 7.

## 6. Channel access semantics

Two independent layers:

1. **Which channels a user sees at all** - `saluran.lihat` shows the
   Saluran page; the per-channel visibility (conversations included in the
   inbox, channel pills, composer override list) is the union of:
   - the OWNER always sees every channel;
   - channels with a ChannelAccess row naming one of the user's grants
     (direct USER row, or a ROLE row matching the user's role) with
     `canView = true`.
2. **What the user can do on a visible channel** - `canCompose` gates the
   composer/send/template/quick-reply on that channel's conversations;
   `canManage` gates the channel's management actions (QR/connect,
   disconnect, test send, agent binding, edit, archive).

Channel CRUD (adding/removing channels as objects) is role-level, not
channel-level: `saluran.tambah`, `saluran.ubah`, `saluran.hapus`.
`saluran.hapus` additionally requires no active conversations OR an explicit
confirm (deletion cascades conversations; keep the existing guard).

### 6.1 KELOLA grants are pairing power - document, warn, audit (owner decision 2026-11-23)

The owner's branch scenario: 3 staff on 3 branches, each scanning their own
QR; another tenant's staff reply-only, QR owner-only. Both are just
ChannelAccess rows: grant KELOLA per user (or per role) on the specific
channel, or do not.

The consequence must be explicit in the product because a Baileys QR scan
PAIRS the WhatsApp session to whoever scans it:

- KELOLA on a Baileys channel = the grantee can scan the QR, which means
  the channel's WhatsApp session can be pointed at a device the grantee
  controls. It is the most powerful grant in the system - stronger than
  any dashboard permission.
- The grant UI must label it accordingly ("Pindai QR / sambungkan sesi -
  granted staff memegang kendali sesi WhatsApp saluran ini") and the audit
  log records every connect/disconnect with the acting user (already
  audit-logged; the actor now comes from run-3 actorEmail).
- `saluran.ubah` (config edits: label, agent binding) stays role-level and
  separate from per-channel KELOLA: a branch staff with KELOLA can scan
  and disconnect their channel but cannot rebind its agent or edit config
  unless their role also has `saluran.ubah`.

### 6.2 Thread per saluran - decided (owner decision 2026-11-23, amended same day)

The earlier "one thread follows the latest channel" rule is SUPERSEDED for
new conversations. A conversation is now bound to ONE channel from birth:

- Identity key changes: `Conversation` unique moves from
  `(tenantId, customerPhone)` to `(tenantId, customerPhone, channelId)`.
  `channelId` is immutable per thread - replies, AI and human, always go out
  the thread's own channel.
- A customer writing on channel 1 then channel 2 gets TWO threads: the
  channel-1 thread stays where it is, frozen with full history; the
  channel-2 thread runs normally. Neither admin's view ever loses a thread
  it could see. The PRD 15 "thread follows the latest message's channel"
  comment and the PRD 28 Part A routing rule are superseded by this
  section (the composer override remains available as a rare human-escape
  hatch but no longer guards any hop).
- Consequence accepted: the AI has NO cross-channel context - the agent
  answering on channel 2 has never seen the channel-1 conversation.
  Correct for multi-branch tenants (each branch is its own shop); the
  memory tool and contact notes bridge what matters.
- Migration: existing threads keep their shape and freeze at their current
  `channelId` (per-message channel history is not stored, so retroactive
  splitting is impossible and unnecessary); the next inbound on a different
  channel opens the new per-channel thread.

### 6.3 Pipeline: one card per customer (owner decision 2026-11-23)

A lead card belongs to the CUSTOMER, not the thread:

- `Deal` gains `contactId`; uniqueness moves from
  `conversationId @unique` to `@@unique([tenantId, contactId])`.
  `conversationId` remains as the pointer to the customer's MOST RECENT
  ACTIVE thread (re-pointed whenever a new thread from the same contact
  opens) so the drawer's context and quick-reply target the live
  conversation.
- `ensureInitialDeal` (new-thread creation): find the deal by the
  conversation's `contactId`. Exists -> do NOT create, do NOT touch the
  stage, only re-point `conversationId` to this thread. Not exists ->
  create as today.
- `deal.setStage` (agent tool) and `setConversationStage`: resolve the
  deal by the conversation's `contactId`, never by `conversationId` alone
  - the current code creates a duplicate card on lookup miss, which is
  exactly the bug this rule removes. Stage moves stay explicit-only:
  agent tool, scenario node, or human drag. No auto-reset on return: a
  "Menang" customer coming back months later keeps the card at "Menang"
  until a human or agent moves it.
- The kanban drawer follows the linked thread's channel visibility: a
  branch admin who cannot view the linked thread cannot open its drawer
  content (card still visible in the board under `pipeline.lihat`).
- Today no duplicates can exist (one customer = one conversation = one
  deal), so the migration is safe: backfill `contactId` from the linked
  conversation, add the unique constraint, change the conversation key.

Conversation-level: the existing human-assignment (Ditugaskan) system is
unchanged and composes with this: a user sees a conversation when their
channel grant has `canView`; the assigned/unassigned tabs keep their current
per-account scoping inside that visible set.

AI replies are NOT affected: the agent loop answers on the conversation's
current channel regardless of channel access (channel access is a human
dashboard control; the AI's channel authority is the channel-agent binding).

## 7. Lockout prevention (non-negotiable)

- The OWNER sees every channel and has every permission - nothing can
  revoke the owner's own access.
- A channel with NO ChannelAccess rows is visible/manageable to the OWNER
  and every user whose role is Akses Penuh (system-role check, not an
  implicit true). This keeps existing single-admin tenants working with
  zero configuration and prevents a freshly-added channel from being
  invisible to everyone.
- Deleting a role or removing a user's role that is referenced by
  ChannelAccess rows: the access rows cascade/clear; the UI warns when the
  last grant for a channel is about to disappear.
- A user can never edit their own role or permissions; role assignment
  changes apply on the target's NEXT request (per-request permission load,
  section 8) - no stale-JWT privilege retention.

## 8. Enforcement architecture

- `requireRole(session, ...)` is replaced by
  `requirePermission(session, "produk.kelola")` across all BFF routes. The
  session's JWT keeps `userId`, `tenantId`, `isOwner`; the PERMISSIONS are
  loaded per request: User join Role in the same query that already fetches
  the revocation stamp (audit run-3) - one query, fresh revocation of both
  password stamp and role changes.
- SSR guards: `withAuth({ requiredPermission })` alongside the role flag.
- Worker/API-v1 realms are unchanged (API tokens are tenant-level, not
  user-level; PRD 23C scope).
- UI nav: the DashboardShell hides sections the caller has no `lihat`
  permission for; route access is still enforced server-side (hidden nav is
  cosmetic, the gate is the API).
- Inbox routes filter `conversation.channelId` by the visible-channel set
  (server-side, in the list query and the detail guard).
- Every permission gate is audited on mutation as today (logHuman), with
  `actorEmail` from run-3.

## 9. UI

1. **Pengaturan > Peran** (new section, OWNER-only): role list (name,
   description, user count, system badge), full-page role editor per the
   established enterprise template - permission matrix grouped by the
   catalog sections, checkbox grid; create duplicates from a system role as
   a starting point; delete guard (reassign users first; system roles
   cannot be deleted).
2. **Pengaturan > Tim**: invite form and the user row gain a Role selector
   (OWNER-only control); `canRunCampaigns` toggle is removed (absorbed by
   role permissions).
3. **Saluran page**: per-channel "Akses" panel (OWNER-only): grant list
   (user or role chips) with LIHAT / KIRIM / KELOLA toggles; add grant
   picker (search users/roles). Channel add/edit/delete buttons render per
   `saluran.tambah/ubah/hapus` permissions.
4. **Inbox**: channel pills show only visible channels; the composer
   override list shows only channels with `canCompose`; a "Saluran tidak
   dapat diakses" state replaces detail views for invisible channels
   (defense for stale links).

## 10. Migration

1. Create Role table; seed Akses Penuh + Admin Chat per tenant.
2. User: add `isOwner`, `roleId`; map OWNER enum users -> `isOwner = true`,
   `roleId = null`; map STAFF users -> `roleId = <Akses Penuh id>`;
   `canRunCampaigns = true` STAFF keep Akses Penuh (no loss); then drop the
   `role` enum column and the `canRunCampaigns` column.
3. ChannelAccess table created empty (defaults cover current behavior).
4. Code: swap requireRole -> requirePermission in one mechanical pass;
   session/JWT shape change deploys atomically with the migration.

Rollout: single atomic deploy (migration + code); the clone stack verifies
first per the standing build flow.

## 11. Requirements

- FR-R1: Tenants can create, edit, duplicate, and delete custom roles with
  any subset of the non-owner-only permission catalog.
- FR-R2: System roles (Akses Penuh, Admin Chat) are seeded per tenant,
  cannot be deleted or renamed, and can be duplicated.
- FR-R3: Exactly one OWNER (isOwner) exists per tenant; the owner cannot be
  demoted and always holds all permissions.
- FR-R4: Role assignment happens at invite time and afterwards from the Tim
  section; changes take effect on the target's next request.
- FR-R5: Every BFF route enforces permissions server-side; hidden nav is
  cosmetic only.
- FR-R6: Per-channel grants (ROLE or USER principal) control LIHAT /
  KIRIM / KELOLA; the inbox, composer, and channel management honor them.
- FR-R7: Role-level `saluran.tambah/ubah/hapus` control channel CRUD.
- FR-R8: A channel with no grants stays visible to the owner and Akses
  Penuh users (lockout prevention).
- FR-R9: All role and grant mutations are audit-logged with the acting
  user's email (run-3 actorEmail).
- FR-R10: Existing STAFF users are migrated to Akses Penuh (no access
  loss); `canRunCampaigns` is retired into `kampanye.kelola`.

## 12. Out of scope (v1)

- Field-level or record-level permissions beyond channel scoping.
- Per-conversation ACLs (assignment covers it).
- Custom permission keys defined by tenants (catalog is code-defined).
- Delegated sub-owners / admin-console roles (PRD 13 stays as is).
- API v1 token realm permissions (tokens act at tenant level, PRD 23C).
- Time-based or conditional rules ("only on weekends").

## 13. Decisions and open questions

Resolved 2026-11-23 (owner session) - ALL questions closed, PRD is final:

1. **Role presets** - the Baca/Edit/Penuh radio pre-fills the matrix
   (section 4.1); the matrix remains the editable source of truth.
2. **KELOLA vs saluran.ubah** - separated, per section 6.1. Per-channel
   KELOLA (including QR scan) can be granted to specific roles AND/OR
   specific staff; config edits stay behind `saluran.ubah`.
3. **Thread per saluran** - section 6.2: conversation key includes
   channelId, immutable binding, old threads frozen in place; supersedes
   PRD 15's "follow latest channel" and simplifies PRD 28 Part A.
4. **Pipeline dedupe** - section 6.3: one card per customer
   (Deal unique per tenant+contact), deal resolved by contact in
   `deal.setStage`/`ensureInitialDeal`, stage never auto-resets,
   conversationId re-pointed to the latest active thread. The agent moves
   the shared card from whichever thread it runs in (owner confirmation:
   "agent can move it by using agents.tool").
5. **Legacy STAFF migration mapping** - Akses Penuh (owner accepted the
   recommendation): nobody loses access on upgrade; owners trim down.
6. **Admin Chat contents** - FULL (kelola) access on inbox, kontak,
   pipeline, tiket, template - not read-only - plus aktivitas.lihat;
   per-channel grants bound WHERE the role can act (section 4 note).
