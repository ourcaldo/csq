# Tenant Roles & Channel Access - Implementation Plan

PRD: docs/prd/29-tenant-roles-and-channel-access.md (final, all 6 decisions
resolved 2026-11-23). Source ref at start: 02fb05f (monorepo).

Six phases, each independently shippable (migration + code + verify + deploy),
ordered so no phase breaks a live behavior until its replacement exists.

## Phase 1 - Roles foundation (additive only)

Migration A (additive; old columns kept until Phase 6):
- Role table (tenantId, name, description, isSystem, permissions String[]).
- User: add isOwner Boolean @default(false), roleId String? FK.
- No drops, no key changes - safe alongside the running app.

Core:
- packages/core/src/lib/permissions-catalog.ts: PERMISSION_CATALOG (groups
  + keys + owner-only list), AKSES_PENUH_KEYS, ADMIN_CHAT_KEYS, presets
  (baca/edit/penuh) for the role editor.
- lib/auth.ts: session gains isOwner; per-request permission load merged
  into the existing stamp-check query (User join Role); requirePermission
  helper; withAuth({ requiredPermission }).
- Seed in the migration: per tenant create Akses Penuh + Admin Chat;
  OWNER users -> isOwner=true; STAFF users -> roleId=Akses Penuh.

Gate swap (mechanical, scripted + hand-check):
- requireRole(session, "OWNER") -> requirePermission(session, "<section>.<a>")
  per the catalog mapping; OWNER+STAFF sites -> the section's .lihat or
  .kelola key. ~100 sites + SSR requiredRole options.
- requireRole stays exported (session.role reads become session-based
  checks against isOwner) until Phase 6 removes the enum.

Verify: full build in Daytona; live: login, inbox, products CRUD, agents
page - all gates fire by permission; STAFF-mapped users have Akses Penuh.

## Phase 2 - Channel access control

Migration B: ChannelAccess table (channelId, principal ROLE|USER,
principalId, canView, canCompose, canManage; unique triple).

Core + BFF:
- lib/channel-access.ts: visibleChannelIds(tenantId, user) = owner -> all;
  system-role Akses Penuh -> all; else union of grants with canView.
  composeChannelIds/manageChannelIds analogous.
- Inbox routes: list/detail/messages/compose filter by visible set;
  composer override list restricted to composeChannelIds.
- Channel management: connect/QR/test/disconnect gated by per-channel
  canManage (or owner); edit/delete/archive by saluran.ubah/hapus.
- Grant CRUD API (OWNER-only) + audit-logged.

Verify: 3-channel tenant simulation on the clone - grant user to one
channel, confirm visibility/compose/QR behaviors + lockout rules.

## Phase 3 - Thread per channel

Migration C: Conversation @@unique([tenantId, customerPhone, channelId])
(additive index change; old unique dropped in the same migration).

Core:
- findOrCreateConversation: key includes channelId; existing-thread update
  path no longer rewrites channelId (immutable binding).
- reconcileLidConversation: merge target lookup adds channelId equality.
- sendHumanReply: drop the "override differs from conv.channelId" window
  nuance where superseded; AI replies unchanged (thread channel).

Verify: two-channel customer test on clone: thread A stays, thread B opens;
LID reconcile still merges within a channel.

## Phase 4 - Pipeline: one card per customer

Migration D: Deal.contactId (backfill from conversation) +
@@unique([tenantId, contactId]); conversationId stays non-unique pointer.

Core:
- ensureInitialDeal: find by contactId; exists -> re-point conversationId
  to the new thread, no stage change; missing -> create.
- setConversationStage + deal.setStage: resolve deal via conversation ->
  contactId. Stage moves remain explicit-only.

Verify: same contact on two channels -> single card, re-pointed; agent tool
moves the shared card from either thread.

## Phase 5 - UI

- Pengaturan > Peran: list + full-page editor (radio preset + grouped
  matrix, system-role badges, duplicate, delete-guard).
- Tim: role selector (invite + edit user); remove canRunCampaigns toggle.
- Saluran: per-channel Akses panel (user/role chips, LIHAT/KIRIM/KELOLA
  toggles, QR-power warning copy).
- DashboardShell nav: sections filtered by permission.
- All role/grant mutations audit-logged with actorEmail.

## Phase 6 - Cleanup migration

Migration E: drop User.role enum column + canRunCampaigns; remove
requireRole legacy shim. Only after live verification of Phases 1-5.

## Standing constraints

- Every phase: tsc + lint + encoding locally, full build in Daytona
  (csq-node sandbox), push monorepo, live verify on the clone, delete
  sandbox.
- No popups except destructive confirms; enterprise template styling;
  green-* tokens; Indonesian UI copy; no em dashes.
- The clone tenant (Toko Kopi) gets its roles seeded by the migration;
  demo password admin@tokokopi.id / demo1234 must survive every phase.
