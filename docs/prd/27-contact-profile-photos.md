# 27 - Contact Profile Photos

Status: proposed 2026-11-19. Owner asked for contact WhatsApp profile
photos in the inbox after confirming the auto-name behavior (names fill
on first inbound only; outbound-first contacts stay as numbers).

## Problem

Contacts in the inbox show an initials circle. For outbound-first
contacts (tenant messaged them via the API / campaigns / Chat Baru and
they never replied) there is no name either - just a phone number.
WhatsApp profile photos would make these contacts recognizable at a
glance.

Unlike the profile NAME (which WhatsApp only sends attached to incoming
messages - see `17` name-fill logic and the Baileys limitation, fetching
a name on demand is an unsupported open issue), the profile PHOTO is
fetchable on demand for any JID on Baileys:
`sock.profilePictureUrl(jid, "image")` returns a WhatsApp CDN URL. The
Cloud API has no equivalent per-recipient photo fetch.

## Scope

- Baileys channels only. Cloud API channels keep the initials circle.
- Photos for contacts that HAVE replied (inbound path) and, on demand,
  for outbound-first contacts.

## Design

### Storage

Store the image BYTES as a `MediaAsset` (tenant-scoped, same table and
serving path as inbound images: `/api/media/<id>`), and put the asset id
on the contact:

- Prisma: `Contact.avatarMediaId String?` with relation to MediaAsset.
- Migration + `_prisma_migrations` ledger on the clone.
- Rationale: WhatsApp CDN URLs expire; a chat UI with silently-broken
  avatars is worse than initials. Bytes are small (profile photos are
  tens of KB) and go through the existing media pipeline.
- The CDN URL itself is NOT stored.

### Fetch triggers (Baileys only)

1. **First inbound message** - same hook as the name fill in
   `recordInboundMessage`: if `Contact.avatarMediaId` is null and the
   channel is Baileys, fetch and store. One fetch per contact, ever
   (photos rarely change; no refresh loop).
2. **Manual backfill** - an owner-triggered action for the existing
   outbound-first contacts: iterate nameless/avatarless contacts with a
   recent conversation, fetch photos in small batches. Bounded (cap per
   run, e.g. 50) to avoid WhatsApp rate-limiting. Triggered from the
   dashboard contacts page or a worker tick; NOT an unbounded loop.

### Fetch failure / privacy

- `profilePictureUrl` returns `undefined` when the user hides photos
   from non-contacts: the contact keeps the initials circle. Never
   retry-storm; a missing photo is a terminal state for that contact
   until a manual re-fetch.
- Fetch errors are logged and swallowed - a photo failure must never
   block message ingest or the agent loop.

### UI

- Inbox conversation row: render the avatar image (via the existing
  media URL) in place of the initials circle when present.
- Contact details pane: same swap.
- Contacts page (Kontak): avatar in the table row when present.
- Fallback everywhere: the current initials circle.

### API surface

- `GET /api/dashboard/inbox/conversations` and contacts list responses
  gain `avatarUrl` (computed server-side from avatarMediaId, media
  base) - no raw media ids leak to the client.
- No new write endpoints; the backfill is owner-only.

## Security

- Avatar bytes are external content: stored as blobs, rendered with
  `<img>` only (no HTML injection path), never fed to the agent prompt.
- MediaAsset is tenant-scoped; the media route enforces tenant auth.
- The Baileys fetch runs inside the worker (the only socket owner),
  never in the web process.

## Out of scope

- Cloud API photos (no supported fetch).
- Photo refresh/rotation for existing avatars.
- Group photos.
- Setting the tenant's own profile photo.
