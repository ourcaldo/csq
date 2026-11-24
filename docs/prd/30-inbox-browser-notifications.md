# 30 - Inbox Browser Notifications

Status: proposed 2026-11-24. Owner request: when a customer chats, the
tenant staff currently learns nothing until someone opens the inbox. Add
browser notifications (Chrome etc.) so an inbound customer message pops up
on the staff member's screen, with a per-user choice between "notify for
all conversations" and "notify only for conversations assigned to me".

Related: PRD 29 (channel visibility, assignment), PRD 15 (multi-channel
inbox), the existing per-conversation SSE stream
(`apps/dashboard/src/pages/api/dashboard/inbox/stream.ts`).

## 1. Problem

- Inbound customer messages land in the DB and the agent may reply, but no
  human is told. The inbox conversation list is not live (loaded once per
  page view); the only realtime piece is the SSE stream of the ONE
  conversation currently open.
- A tenant with 3 chat admins loses leads to silence: nobody knows a chat
  arrived without refreshing the inbox.
- The unread badge exists but only recomputes when a page is opened - same
  problem.

## 2. Concept

A browser-level `Notification` (the OS toast Chrome/Firefox/Edge show) per
inbound customer message, driven by a tenant-wide realtime stream:

1. A NEW SSE endpoint streams "new inbound message" events for the whole
   tenant (scoped to the requesting user's visible channels, PRD 29),
   using the same Postgres-poll pattern as the existing stream (3s poll,
   15s heartbeat, cursor + id dedupe). No new infrastructure - no Redis, no
   websocket server, no worker change.
2. A listener mounted ONCE in the dashboard shell (every page, not just
   the inbox) subscribes to that stream and fires
   `new Notification(...)` for each qualifying event while ANY dashboard
   tab is open.
3. The user picks the scope: ALL conversations vs ASSIGNED-TO-ME only vs
   OFF. Stored per user, so it survives devices and browser data resets.

This answers the two owner questions directly:

- Yes, it is doable, entirely inside the existing stack.
- Yes, the all / assigned-only choice is exactly the right model; it is a
  per-USER preference (each staff member decides their own noise level),
  not a tenant-wide setting.

## 3. Delivery mechanics (Phase 1 - this PRD)

- Endpoint: `GET /api/dashboard/inbox/notify-stream`. Gated on
  `inbox.lihat` + tenant scope, and filtered server-side by
  `visibleChannelIds(session)` exactly like every sibling inbox route.
- Event payload per inbound message: conversationId, channelId, customer
  name (or phone), message snippet (first ~80 chars), receivedAt. Inbound
  CUSTOMER messages only - the poll queries
  `{ direction: INBOUND, senderType: CUSTOMER, kind: TEXT | MEDIA }`.
  Agent/human/system/campaign messages never notify (they are the
  tenant's own activity).
- Client: one `EventSource` in the dashboard shell, alive on every
  authenticated dashboard page. On reconnect it does NOT replay history
  (cursor starts at connect time); a notification for a chat that is
  minutes old would be noise, and the unread badge covers catch-up.
- Notification content: title = customer name or phone; body = snippet;
  `tag = conversationId` so a chatty customer replaces their own previous
  toast instead of stacking, and multiple open tabs do not double-toast
  (same tag dedupes at the browser level).
- Click: focus the dashboard tab and navigate to
  `/dashboard/inbox?c=<conversationId>`.
- Document title badge: `(n) CSQ` unread count on the inbox nav and
  document title, recomputed from the same stream. Cheap and covers the
  "tab is open but ignored" case.
- Browser permission: requested ONLY from an explicit user gesture (the
  bell toggle), never on page load. If the browser blocks, the UI says so
  in Indonesian and links to the browser's own help - no dark patterns,
  no permission nagging.

Phase 1 limitation (accepted): notifications fire only while a dashboard
tab is open (background tab is fine; closed browser gets nothing). This
covers the owner's stated scenario (staff working in the dashboard who
miss chats). True closed-browser push is Phase 2 (section 10).

## 4. Scope rules

Per-user setting, three values:

| Value | Meaning |
|---|---|
| `all` | Notify for every inbound message on every conversation the user can LIHAT |
| `assigned` | Notify only when `conversation.assigneeUserId` = the user |
| `off` | No notifications (stream stays connected for the badge, or disconnects - implementation choice) |

- Default: `assigned` (safe default - a 5-staff tenant with everyone on
  `all` gets 5 toasts per customer message; each person opts INTO more
  noise, never into it by surprise). The OWNER account defaults to `all`.
- Scope is evaluated SERVER-SIDE in the stream (the poll filters by
  assignment when the user's pref is `assigned`) so the client cannot
  widen its own scope, and channel visibility filtering stays
  server-side too.
- Notifications respect PRD 29 channel access end to end: a user with no
  grant on channel X never receives events from channel X, all or
  assigned mode alike.

## 5. Suppression rules

Do NOT notify when:

1. The message belongs to the conversation the user is CURRENTLY viewing
   (they are already reading it - client-side check against the open
   conversationId; toast would be pure noise).
2. The user's pref is `off`, or the browser permission is
   denied/default.
3. The message is not inbound-customer (section 3).
4. Rate cap: at most 1 notification per conversation per 10s window
   (the `tag` dedupe mostly covers this; the cap is a safety valve for
   flood-style bursts so a webhook redelivery storm cannot machine-gun
   the user).

## 6. UI

- Bell control in the inbox header (and the dashboard shell topbar when
  the shell listener ships): dropdown with the three scope options in
  Indonesian - "Semua percakapan" / "Hanya ditugaskan ke saya" /
  "Nonaktif" - plus the browser-permission state and an enable button
  that triggers `requestPermission()`.
- The dropdown is a settings control, not an entity editor, so it is exempt
  from the full-page-editor rule (that rule governs entity management
  flows). The preference is also editable as a plain row under
  Pengaturan > Umum ("Notifikasi percakapan masuk") so users can find it
  without hunting the bell.
- Toast copy is Indonesian, e.g. "Aldo: Halo, ini masih ada?".

## 7. Data model

```prisma
model User {
  // Per-user dashboard preferences. v1 holds one key:
  // { inboxNotify: "all" | "assigned" | "off" }
  notificationPrefs Json?
}
```

- Nullable JSON, default null = server default (`assigned`; owner
  account `all`). One migration, no backfill.
- Written by a small BFF route
  (`POST /api/dashboard/settings/notifications`), gated on the session
  being the user themself (no permission key needed - it is a self
  preference, not tenant configuration; a user can never write another
  user's prefs).
- Read path: the shell GSSP already loads the session; it loads
  `notificationPrefs` with it and passes the scope to the client.

## 8. Security and tenancy

- The stream re-authenticates per connection (session cookie), scopes to
  tenant + visible channels, and filters by the user's own preference.
- Message snippets in notifications are the tenant's own data shown to
  their own authenticated staff - no cross-tenant surface. The endpoint
  returns nothing a sibling inbox route would not already return.
- No new external service, no push provider, no secrets. (That is the
  Phase 2 cost that is being deferred.)

## 9. Requirements

- FR-N1: A user with a dashboard tab open receives a browser notification
  for every qualifying inbound customer message within ~3-5s of arrival.
- FR-N2: Scope is per-user and user-switchable at any time between
  semua / ditugaskan / nonaktif; default ditugaskan (owner: semua).
- FR-N3: Channel access (PRD 29 LIHAT) filters notifications server-side.
- FR-N4: Notification click focuses the tab and opens the conversation.
- FR-N5: No notification for the conversation the user currently has
  open, nor for non-inbound messages.
- FR-N6: Duplicate suppression: same conversation replaces its own toast
  (tag dedupe); max 1 per conversation per 10s.
- FR-N7: Browser permission is requested only from an explicit toggle;
  denial is surfaced with recovery guidance.
- FR-N8: Unread count badge (nav + document title) recomputes live from
  the same stream.
- FR-N9: The preference persists server-side per user (survives device
  change); a user can only read/write their own preference.

## 10. Out of scope (v1) - Phase 2 candidates

- **Web Push (closed browser)**: service worker + VAPID keypair +
  `PushSubscription` table + `web-push` sends from the worker's ingest
  path. Real infrastructure with key management and per-browser
  subscription hygiene; only worth it once tenants actually work with
  the dashboard closed. Deferred pending owner demand.
- Email / WhatsApp-to-owner notifications, mobile app push, per-channel
  or per-time-window rules, mention notifications, notification center /
  history in-app.
- iOS Safari in-browser notifications (requires an installed PWA even
  with Web Push; note in docs, do not chase in v1).

## 11. Open questions for the owner

1. Default scope for staff: `assigned` (recommended) or `all`?
2. Should the notification play a sound / vibrate on mobile? Browsers do
   a default OS sound; custom sounds are skippable (recommended: skip).
3. Is Phase 2 (Web Push for closed browser) wanted soon, or is
   "dashboard must be open somewhere" acceptable for v1? (Recommended:
   v1 as specced; revisit after real usage.)
