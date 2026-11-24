# 30 - Inbox Browser Notifications

Status: implemented and live-verified 2026-11-24. Owner decisions
resolved same day: default scope is SEMUA for every user; notifications
keep the system sound (no custom audio); Web Push is IN v1 scope (delivery
when the browser is closed). Live-verified: pref round-trip,
subscribe/upsert/prune, tenant SSE emission on inbound, real
web-push send to the push service with dead-endpoint pruning.
In-browser toast delivery still needs a real user "Izinkan" grant
(headless browsers pre-deny it).

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

A browser-level notification (the OS toast Chrome/Firefox/Edge show) per
inbound customer message, delivered through TWO coordinated channels:

1. **Foreground (tab open)** - a NEW tenant-wide SSE endpoint streams "new
   inbound message" events; a listener mounted ONCE in the dashboard shell
   fires `new Notification(...)` with precise suppression (never for the
   conversation the user is currently reading).
2. **Background (browser closed or all tabs hidden)** - Web Push: a
   service worker receives a push from the server and shows the
   notification even with the browser closed. One push subscription per
   browser/device per user; scope is still evaluated server-side from the
   user's preference.

The user picks the scope: ALL conversations (default, owner decision) vs
ASSIGNED-TO-ME only vs OFF. Stored per user, so it survives devices and
browser data resets.

This answers the two owner questions directly:

- Yes, it is doable inside the existing stack (Postgres as the only data
  store; one new subscription table; VAPID keys in env).
- Yes, the all / assigned-only choice is exactly the right model; it is a
  per-USER preference (each staff member decides their own noise level),
  not a tenant-wide setting.

## 3. Foreground delivery (SSE)

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
  (cursor starts at connect time); the unread badge covers catch-up.
- Notification content: title = customer name or phone; body = snippet;
  `tag = conversationId` so a chatty customer replaces their own previous
  toast instead of stacking, and multiple open tabs do not double-toast
  (same tag dedupes at the browser level).
- **Sound**: no custom audio; every notification is created with
  `silent: false` so the OS/browser default notification sound plays.
  Whether a sound is audible still depends on the user's OS notification
  settings - that is expected and documented in the settings row.
- Click: focus the dashboard tab and navigate to
  `/dashboard/inbox?c=<conversationId>`.
- Document title badge: `(n) CSQ` unread count on the inbox nav and
  document title, recomputed from the same stream. Cheap and covers the
  "tab is open but ignored" case.
- Browser permission: requested ONLY from an explicit user gesture (the
  bell toggle), never on page load. If the browser blocks, the UI says so
  in Indonesian and links to the browser's own help - no dark patterns,
  no permission nagging.

## 4. Background delivery (Web Push)

- **Service worker** `apps/dashboard/public/sw.js` (scope `/`): handles
  `push` (show notification) and `notificationclick` (focus/open
  `/dashboard/inbox?c=<conversationId>`).
- **Subscription**: when the user grants notification permission and
  their pref is not `off`, the client calls
  `pushManager.subscribe({ applicationServerKey: <VAPID public key> })`
  and POSTs the subscription to the BFF
  (`POST /api/dashboard/notifications/subscribe`), which upserts it for
  the CURRENT user (one row per endpoint; a user may have many devices).
  Unsubscribe on permission revoke or pref `off` cleans the row
  (client-initiated DELETE), and the server prunes endpoints that answer
  404/410 on send.
- **Sending**: one shared core function `sendInboundPush()` called
  fire-and-forget from `ingestInboundMessage` (the single ingest choke
  point both providers already cross - Cloud API webhook in `apps/api`,
  Baileys runtime in `apps/worker`). It:
  1. loads the tenant's users with `notificationPrefs.inboxNotify` !=
     `off` and at least one subscription;
  2. filters by the user's channel visibility (PRD 29 LIHAT; a user-id
     variant of `visibleChannelIds`) and by `assigned` scope when set;
  3. sends the encrypted payload (`web-push`, TTL 1h) to each
     subscription.
  Because the send runs in both services, `VAPID_*` env vars are needed
  on `csq-api` AND `csq-worker`.
- **Payload**: `{ conversationId, title, body, tag }` - same shape as the
  SSE toast. Push payloads are end-to-end encrypted by the Web Push
  protocol (only the browser can decrypt); the push service (Google/
  Mozilla) sees ciphertext only.
- **Double-toast guard**: the service worker's `push` handler checks
  `clients.matchAll({ type: "window" })`; if a dashboard window is
  VISIBLE (`visibilityState === "visible"`), it skips showing the toast -
  the foreground SSE listener is already on the job with smarter
  suppression. When every tab is hidden or none exists, the SW shows it.
- **Rate cap**: max 1 push per (user, conversation) per 10s, enforced
  server-side before sending (flood/redelivery guard); `tag` dedupe is
  the client-side backstop.

Accepted limitation: iOS Safari needs the dashboard installed as a PWA
before Web Push works at all (platform rule); the settings row notes it
instead of chasing it.

## 5. Scope rules

Per-user setting, three values:

| Value | Meaning |
|---|---|
| `all` | Notify for every inbound message on every conversation the user can LIHAT (DEFAULT, owner decision 2026-11-24) |
| `assigned` | Notify only when `conversation.assigneeUserId` = the user |
| `off` | No notifications |

- Default: `all` for every user, owner included (owner decision
  2026-11-24). A user who wants less noise switches to `assigned` or
  `off` themselves.
- Both the SSE stream and the push send evaluate scope SERVER-SIDE (the
  poll/sender filters by assignment when `assigned`) so a client cannot
  widen its own scope, and channel visibility filtering stays
  server-side too.
- Notifications respect PRD 29 channel access end to end: a user with no
  grant on channel X never receives events from channel X, all or
  assigned mode alike.

## 6. Suppression rules

Do NOT notify when:

1. The message belongs to the conversation the user is CURRENTLY viewing
   (foreground path only - they are already reading it; the background
   path cannot know this and always notifies).
2. The user's pref is `off`, or the browser permission is
   denied/default.
3. The message is not inbound-customer (section 3).
4. Rate cap: at most 1 notification per conversation per 10s window per
   user (SSE client cap; the push path enforces the same cap
   server-side). Safety valve so a webhook redelivery storm cannot
   machine-gun the user.

## 7. UI

- Bell control in the dashboard shell topbar (every page): dropdown with
  the three scope options in Indonesian - "Semua percakapan" / "Hanya
  ditugaskan ke saya" / "Nonaktif" - plus the browser-permission state
  and an enable button that triggers `requestPermission()` AND the
  `pushManager.subscribe` flow (section 4). Turning the scope off
  unsubscribes the push and/or silences the SSE listener.
- The bell shows a dot when browser permission is pending/denied with a
  one-line recovery path (open browser site settings).
- The dropdown is a settings control, not an entity editor, so it is exempt
  from the full-page-editor rule (that rule governs entity management
  flows). The preference is also editable as a plain row under
  Pengaturan > Umum ("Notifikasi percakapan masuk") so users can find it
  without hunting the bell.
- Toast copy is Indonesian, e.g. "Aldo: Halo, ini masih ada?".

## 8. Data model

```prisma
model User {
  // Per-user dashboard preferences. v1 holds one key:
  // { inboxNotify: "all" | "assigned" | "off" }
  notificationPrefs Json?
}

// One browser/device per row. A user may have several devices; all are
// pruned when the push service answers 404/410 (browser uninstalled,
// subscription expired). The endpoint + keys are the push capability -
// server-side only, never returned to clients other than a no-op status.
model PushSubscription {
  id        String   @id @default(uuid())
  tenantId  String
  userId    String
  endpoint  String   @unique
  p256dh    String
  auth      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([userId])
}
```

- `notificationPrefs`: nullable JSON, default null = `all` (owner decision
  2026-11-24). One migration, no backfill.
- Written by small BFF routes
  (`POST /api/dashboard/settings/notifications` for the pref,
  `POST/DELETE /api/dashboard/notifications/subscribe` for the
  subscription), each gated on the session being the user themself (no
  permission key needed - self preference, not tenant configuration; a
  user can never write another user's prefs or subscriptions).
- Read path (implemented): the notification context fetches
  `GET /api/dashboard/settings/notifications` once on mount; the route
  returns the user's `inboxNotify` scope and the VAPID public key (the
  private key never leaves the api/worker processes).
- Env (set on `csq-api` AND `csq-worker` - both ingest paths send):
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (generated once with
  `npx web-push generate-vapid-keys`). The public key is public by
  design; the private key never leaves the server. `web-push` is the one
  new dependency.

## 9. Security and tenancy

- The stream re-authenticates per connection (session cookie), scopes to
  tenant + visible channels, and filters by the user's own preference.
- Push sends re-evaluate everything server-side per message: user pref,
  channel visibility, assignment. The browser client is never trusted
  with scope.
- Message snippets in notifications are the tenant's own data shown to
  their own authenticated staff - no cross-tenant surface. Push payloads
  are end-to-end encrypted by the Web Push protocol; the push service
  (Google/Mozilla) carries ciphertext only.
- Push endpoints are bearer capabilities: stored server-side, returned to
  no client. Pruned on 404/410 so dead endpoints do not accumulate.
- No other new external service; the push relay is the browser platform's
  own (FCM/APNs/Mozilla), addressed only with the VAPID-authorized
  requests above.

## 10. Requirements

- FR-N1: A user with a dashboard tab open receives a browser notification
  for every qualifying inbound customer message within ~3-5s of arrival.
- FR-N2: Scope is per-user and user-switchable at any time between
  semua / ditugaskan / nonaktif; default SEMUA for every user (owner
  decision 2026-11-24).
- FR-N3: Channel access (PRD 29 LIHAT) filters notifications server-side.
- FR-N4: Notification click focuses the tab and opens the conversation
  (foreground) or focuses/opens the dashboard at that conversation
  (service worker).
- FR-N5: No notification for the conversation the user currently has
  open, nor for non-inbound messages.
- FR-N6: Duplicate suppression: same conversation replaces its own toast
  (tag dedupe); max 1 per conversation per 10s per user.
- FR-N7: Browser permission is requested only from an explicit toggle;
  denial is surfaced with recovery guidance.
- FR-N8: Unread count badge (nav + document title) recomputes live from
  the same stream.
- FR-N9: The preference persists server-side per user (survives device
  change); a user can only read/write their own preference.
- FR-N10: With every dashboard tab closed, an inbound customer message
  still produces an OS notification via Web Push, within the same ~3-5s
  window; the service worker suppresses it when a dashboard window is
  visible (the foreground path owns that case).
- FR-N11: Notifications keep the OS default sound (`silent: false`, no
  custom audio); the settings row states that audibility also depends on
  OS notification settings.
- FR-N12: Push subscriptions are per user per device; dead endpoints
  (404/410) are pruned automatically; a user turning the scope to
  Nonaktif or revoking permission stops delivery and removes the
  subscription.

## 11. Out of scope (v1)

- Email / WhatsApp-to-owner notifications, mobile app push, per-channel
  or per-time-window rules, mention notifications, notification center /
  history in-app.
- iOS Safari in-browser notifications (requires the dashboard installed
  as a PWA even for Web Push; noted in the settings row, not chased in
  v1).
- Notification preferences managed by the OWNER on behalf of staff (it
  is a self preference).

## 12. Decisions (resolved 2026-11-24, owner session)

1. Default scope: SEMUA for every user, owner included.
2. Sound: no custom audio; keep the OS default sound on every
   notification.
3. Web Push: IN v1 scope - notifications must arrive with the browser
   closed. Service worker + VAPID + `PushSubscription` are part of this
   feature, not a later phase.
