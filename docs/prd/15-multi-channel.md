# 15. Multiple Channels per Tenant (owner direction 2026-11-09)

Status: **PENDING** - direction approved, not scheduled. Execution plan:
`docs/plans/2026-11-09-multi-channel-plan.md`. Do not start before the
owner schedules it.

## Decision

- A tenant (workspace) can hold **multiple WhatsApp channels**. A channel is
  one sending phone number: a Cloud API phone number ID or a paired Baileys
  number.
- A channel is **not** a tenant. Do not create a tenant per number. Separate
  tenants stay reserved for businesses or brands that must not share data.
- The plan's `channelLimit` counts **connected** channels and becomes a real
  dimension once this ships. Basic (1) means one active number; a higher plan
  means more.
- Multiple WABAs are allowed under the same tenant; `wabaId` is metadata for
  grouping and display, not a separate entity.

## Why

- Every mainstream CRM (HubSpot, Zendesk, Intercom, respond.io, WATI,
  Twilio) treats the phone number as a channel inside one workspace. Agents
  work one inbox and filter by channel. One workspace per number is the
  exception, used for legal or brand isolation.
- Meta's model supports it: a WABA exposes a list of phone numbers
  (`GET /<WABA_ID>/phone_numbers`), each with its own phone number ID,
  display number and quality rating.
- Current official docs: a new business portfolio starts capped at **two
  registered phone numbers**, then **20** after business verification or
  reaching the 2,000 messaging limit
  (https://developers.facebook.com/docs/whatsapp/cloud-api/phone-numbers/,
  fetched 2026-11-09). A plan may sell more than two, but Meta's cap binds
  first until the customer verifies.
- Without this feature, selling `channelLimit` above 1 is fiction: the
  product can hold one Cloud API number and one Baileys number, and the
  Saluran page manages one active connection.

## Current state (deep dive 2026-11-09)

Already multi-channel-ready:

- `Channel` rows are not unique per tenant. `Conversation` is unique per
  `(tenantId, channelId, customerPhone)`. `Contact` is unique per
  `(tenantId, phone)`, so a customer is one contact across channels.
- `Campaign.channelId` exists and the campaign UI already filters connected
  channels and has a "Saluran kirim" selector.
- The Cloud API webhook POST routes by `phone_number_id` to the exact
  channel, and rejects a POST that mixes numbers.
- Baileys sockets are a `Map<channelId, entry>`; leases are
  `baileys-socket:{channelId}`; `ChannelCommand` is per channel. The worker
  can own multiple sockets.
- Agent replies use the conversation's channel. Approval follow-ups resolve
  the conversation's channel. Scenarios send through the conversation's
  channel.
- Admin channel fleet already lists every channel row with per-channel
  reconnect/disconnect.
- Usage counts CONNECTED channels only.

Blockers:

1. `POST /api/dashboard/channels/connect` does `findFirst({ tenantId,
   provider })` and updates that row. It never creates a second channel for
   the same provider.
2. The Saluran page picks one `connected` channel and one row per provider;
   it has no list, no add, no per-channel actions.
3. Cloud API webhook verification uses a **per-channel** `verifyToken` in
   `config`, and disconnect rotates it. One Meta app has one callback URL and
   one verify token, so a second number cannot be verified reliably and a
   disconnect can break the others.
4. Channel identity lives in `config` JSON. There is no `label`, display
   number, external ID, or WABA ID column, so the UI cannot list or
   deduplicate channels without parsing secrets.
5. The inbox has `channelId` on the conversation type but never shows or
   filters by channel.
6. There is no archive. Hard delete would cascade conversations, messages
   and campaigns.
7. The admin fleet lacks label and number.
8. The campaign selector shows the provider only, not which number.

## Data model

Add to `Channel`:

| Column | Meaning | Notes |
|---|---|---|
| `label` | Owner-facing name ("Sales", "Support") | Required on create |
| `phoneNumber` | Display number, E.164 when known | Filled from Meta for Cloud API, from the paired JID for Baileys |
| `externalId` | Provider identity: phone number ID (Cloud API) or phone/JID (Baileys) | Unique per tenant and provider when not null |
| `wabaId` | Optional Cloud API WABA grouping | Metadata only |
| `archivedAt` | Soft archive timestamp | Hidden from lists, data retained |

- Unique index `(tenantId, provider, externalId)`. Postgres allows multiple
  NULLs, so a Baileys channel is valid before pairing.
- `config` keeps secrets only (`token`, `appSecret`, `verifyToken` legacy,
  Baileys ToS flag). Identity moves to columns.
- No hard delete. Archive is allowed only while the channel is DISCONNECTED.
  Conversations, messages, campaigns and invoices stay intact.
- Migration backfills `label` from the provider name, `externalId` from
  `config.phoneNumberId` for Cloud API, and leaves Baileys `externalId` null
  until the next pairing.

## Connect flow

- "Tambah saluran" opens a provider choice, then a form with a required
  label.
- Cloud API: phone number ID, access token, optional WABA ID. The app secret
  comes from `WHATSAPP_APP_SECRET` (per-channel override only for edge
  cases). On submit, call the Graph API to verify the phone number ID and
  fetch the display number and WABA; reject a number already registered to
  another tenant.
- Baileys: label, ToS acknowledgement, QR. The phone number is discovered
  when the socket opens and written to `phoneNumber` and `externalId`.
- Channel limit check on connect: count CONNECTED channels; block when the
  plan limit is reached and the target is not already connected.
- Reconnect and edit are per channel. Archive only when disconnected.

## Webhook

- Verification moves to **app level**: `WHATSAPP_VERIFY_TOKEN` and
  `WHATSAPP_APP_SECRET` env vars. One Meta app, one callback URL, all
  numbers. The legacy per-channel token is accepted as a fallback during a
  transition window only.
- Disconnect no longer rotates the verify token.
- POST continues to route by `phone_number_id`; the unique index guarantees
  one channel per number. Unknown numbers still ACK and record a diagnostic.
- Signature verification uses the app secret from env; the per-channel
  override remains for unusual setups.

## Runtime

- Sockets, leases, commands and LID mappings are already per channel. No
  schema change.
- Each Baileys socket costs memory and CPU. The worker must cap concurrent
  sockets per instance and log when the cap is hit; the plan limit is the
  commercial cap, the worker cap is the safety cap.
- Startup reconnect must iterate every non-archived Baileys channel, not
  assume one.

## Inbox

- Show the channel label as a badge in the conversation list and the chat
  header.
- Add a channel filter ("Semua saluran" plus each channel).
- The same customer on two numbers has two conversations (correct) and one
  contact (already true). Do not merge conversations.
- Assignment stays per conversation. The channel's default agent still
  applies when the conversation has no explicit agent.

## Campaigns and scenarios

- Campaigns are per channel already (`Campaign.channelId`). The selector
  must show label and number, not just the provider.
- In-flight campaign runs keep their channel; a campaign cannot switch
  channel mid-run.
- Scenarios use the conversation's channel. No change.

## Limits and Meta caps

- `channelLimit` counts CONNECTED channels across providers.
- Basic 1; a plan may set 2 or more.
- Meta's 2 to 20 registered-number cap is a platform limit. The connect
  flow must surface Meta's error, not fail silently.
- MAU and AI credits stay tenant-level and are not split per channel.

## Admin console

- Fleet table adds label, number and WABA (when set). Filters by tenant and
  status.
- Per-channel actions stay. The admin can see a tenant's full fleet without
  reading `config`.
- No admin create-on-behalf flow in this phase; the tenant owner connects.

## Security

- Channel responses expose label, display number, provider, status,
  external ID and WABA ID only. Tokens and app secrets never leave the
  server.
- The verify token and app secret are app-level env, not per-channel rows.
- Archive retains data; nothing cascades on archive.
- A phone number ID can belong to exactly one tenant. Cross-tenant
  duplicates are rejected on connect and by the unique index.

## Migration

- Add the columns and indexes; backfill existing rows.
- Existing single-channel tenants keep working: their one channel gets a
  label and, for Cloud API, an external ID.
- No conversation or message migration. Nothing is rewritten.

## Out of scope

One tenant per number, cross-channel conversation merge, per-channel
billing, channel-level analytics dashboards, number porting, Cloud API
Embedded Signup, multiple worker instances sharing sockets, and a separate
WABA entity beyond the `wabaId` metadata.

## Acceptance criteria

- A tenant on a 2-channel plan connects two Cloud API numbers; both show
  CONNECTED, and a third is blocked with a clear message.
- Inbound from number A creates a conversation on channel A; the reply goes
  out from A. Number B is independent.
- The same customer messaging A and B produces two conversations and one
  contact.
- Webhook verification succeeds with the app-level token for every number;
  disconnecting A does not break B.
- The inbox shows and filters by channel label.
- A campaign targets a chosen channel by label and number.
- Archiving a disconnected channel hides it, keeps its conversations, and
  frees a plan seat.
- Admin fleet shows label, number and WABA.
- Existing single-channel tenants see no change after migration.

## Decisions to confirm before execution

1. Archive vs hard delete: recommend archive only, with data retained.
2. App-level verify token and app secret: recommend yes, with a short
   transition fallback for the legacy per-channel token.
3. Graph API verification on connect: recommend yes, so a wrong number ID
   fails immediately.
4. Label required on create: recommend yes.
5. Per-channel analytics: defer.
