# 28 - Inbox Channel UX, Pipeline/Kampanye Fixes, Team Invites, Sidebar

Status: proposed 2026-11-21. Consolidates the owner's channel-selection
design (mocked in docs/demo/inbox-selector-mock.html) with five reported
bugs/gaps into one prioritized PRD. Each item is independently shippable.

## Part A - Channel selection UX (approved direction, mocked)

Owner decisions from the 2026-11-21 design session:
- Channel filtering in the conversation list must be one click, always
  visible (icon-only pills under the tabs; hover tooltip = name + phone;
  distinct icon colors per Baileys channel, blue for Cloud API). Scales to
  ~8 channels in one row. No Faders/dropdown for channel switching.
- The composer carries a reply-from channel selector chip inside the input
  field: defaults to the conversation's current channel, click opens a
  popover of all channels (with phone numbers; Cloud API shows a
  "24 jam tutup" warning when outside the window), one click overrides.
- The override is REMEMBERED per conversation (stored server-side on the
  Conversation, e.g. settings.replyChannelId - not localStorage), survives
  device switches, applies to whoever opens the thread.
- Routing rules:
  - Human reply, no override: conversation's current channel (last inbound).
  - Human reply, override chosen: the remembered override.
  - AI reply: ALWAYS the conversation's current channel (last inbound) -
    the override is a human-reply preference; a stale override must not
    break window coherence or surprise the customer.
- Send path must honor the override: the dashboard reply route currently
  sends via conversation.channelId; it needs to accept the chosen channel
  (validated: same tenant, provider rules, 24h window check for CLOUD_API
  with a clear error when blocked).

## Part B - Manajemen Pipeline auto-refresh

Problem: the pipeline board shows stale data until a manual page reload.
Owner: "Manajemen Pipeline harus di reload dulu biar datanya muncul."
Requirement:
- The board auto-refreshes (poll or SSE like the inbox) so stage moves,
  deal changes, and new leads appear without reload. Target: <= 8s
  staleness, silent (no skeleton flash), and a manual refresh button.
- Same treatment for the deal drawer if it renders stage/deal state.

## Part C - Kampanye edit loses data in the frontend

Bug: editing a campaign shows missing/blank data in the wizard (fields not
populated even though the API holds them). Requirement:
- Opening /dashboard/campaigns/[id] pre-fills EVERY section exactly as
  saved: name, channel, audience (incl. selected categories/tags/contacts),
  template, body, images, schedule kind + config, delay.
- Acceptance: edit a fully-configured campaign, change nothing, save -
  the saved row is byte-identical to before. No field silently resets.

## Part D - Campaign failure handling: auto-pause + resend

Two requirements:
1. A campaign whose fire fails with channel_missing_or_disconnected (or
   the channel being deleted/disconnected between runs) must AUTO-PAUSE
   with a visible status/reason on the list card - not keep "running"
   silently. The owner sees "Dijeda otomatis - saluran terputus" with the
   reconnect/edit action visible.
2. Resend failed recipients: on the Riwayat page, a run with Gagal rows
   offers "Kirim Ulang yang Gagal" (owner-only). It creates a new run
   containing only the FAILED recipients of that run (same body/template/
   images, same channel rules); SKIPPED rows are NOT auto-resent (window
   skips are correct behavior) but the owner may see them listed. Bounded
   and rate-limited like any campaign send.

## Part E - Collapsible sidebar

The dashboard sidebar collapses to icon-only (or a slim rail) with a
toggle; state persisted per browser. Standard drawer pattern: expanded by
default, collapse persists across sessions, tooltips show labels when
collapsed. Must not break the inbox full-bleed layout (flush mode).

## Part F - Team invitation reliability + management

Owner report (2026-11-21): sending an invitation failed, and accepting
one returned "Tautan undangan tidak valid." Two workstreams:
1. Fix the root causes:
   - Invite send failure must surface the real error on the Team page
     (currently silently fails or shows nothing actionable).
   - "Tautan undangan tidak valid" on accept: diagnose - likely causes:
     token hash mismatch (email pipeline altering the URL?), expired
     TTL, already-accepted burn, or the send-failure above producing a
     link that was never actually created. Reproduce, fix, and make the
     accept page distinguish "invalid", "expired", and "already used"
     with clear Indonesian copy for each.
2. Invitation management on the Team page:
   - List PENDING invitations: email, sent date, expiry countdown,
     status (Menunggu / Kedaluwarsa / Diterima).
   - Owner can CANCEL (revoke) a pending invitation anytime - the token
     is dead immediately, the seat is freed from the staffLimit count.
   - Re-send option for a pending/expired invite (new token, same email).
   - Expired invites show as Kedaluwarsa and can be re-sent or deleted.

## Priority order (owner-adjustable)

1. Part F - team invites are broken TODAY (blocking onboarding).
2. Part C - campaign edit data loss (data-integrity, quick fix).
3. Part D - auto-pause (campaign integrity) then resend.
4. Part B - pipeline auto-refresh.
5. Part A - channel selector UX (mocked, ready to build).
6. Part E - collapsible sidebar (cosmetic).

## Out of scope

- Mobile-specific tooltip alternatives for icon-only pills (composer
  popover remains the fallback).
- Splitting conversations per channel (rejected in the design session).
- AI-channel override (explicitly decided against in Part A).
