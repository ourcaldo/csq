# Multiple Channels per Tenant - Implementation Plan (2026-11-09)

Status: **PENDING** - not scheduled, do not execute. PRD:
`docs/prd/15-multi-channel.md`. The owner will schedule this later.

## Deep dive summary

The runtime and data model are mostly ready. The blockers are the connect
flow, the Saluran UI, webhook verification, and missing channel identity.

Ready today:

- `Channel` rows are per tenant with no unique provider constraint.
- `Conversation` is unique per `(tenantId, channelId, customerPhone)`.
- `Contact` is unique per `(tenantId, phone)`.
- `Campaign.channelId` and a campaign channel selector already exist.
- Cloud API webhook POST routes by `phone_number_id`.
- Baileys sockets, leases, LID mappings and commands are keyed by
  `channelId`.
- Agent replies, approval follow-ups and scenarios use the conversation's
  channel.
- Admin fleet lists every channel row.

Not ready:

- Connect upserts one channel per provider.
- Saluran page assumes one connected channel.
- Cloud API verification uses a per-channel token that disconnect rotates.
- No label, display number, external ID or WABA columns.
- Inbox has no channel badge or filter.
- No archive; delete would cascade.

## Phase 0 - Channel identity and migration

- [ ] `Channel`: add `label`, `phoneNumber`, `externalId`, `wabaId`,
      `archivedAt`.
- [ ] Unique index `(tenantId, provider, externalId)`.
- [ ] Migration backfills `label` from the provider name and `externalId`
      from `config.phoneNumberId` for Cloud API. Baileys stays null until
      the next pairing.
- [ ] Extend `ChannelView` and the channels API with label, number, external
      ID and WABA. Keep secrets out.
- [ ] Gate: migration applies on the clone; the existing channel list still
      renders; no token appears in any response.

## Phase 1 - App-level webhook

- [ ] Add `WHATSAPP_VERIFY_TOKEN` and use `WHATSAPP_APP_SECRET` as the
      app-level secret. Document both in `.env.example`.
- [ ] Webhook GET compares against the app token. Accept the legacy
      per-channel `config.verifyToken` as a fallback during the transition.
- [ ] Webhook POST signature uses the app secret; keep the per-channel
      override for edge cases.
- [ ] Disconnect stops rotating the verify token.
- [ ] Gate: verification succeeds for two Cloud API numbers with one app
      token; disconnecting one does not break the other; unknown
      `phone_number_id` still ACKs and records a diagnostic.

## Phase 2 - Connect flow and Saluran page

- [ ] `connect.ts`: create a new channel instead of upserting by provider.
      Validate label, provider, credentials, and the plan limit (connected
      channels only).
- [ ] Cloud API: call the Graph API to verify the phone number ID, fetch the
      display number and WABA, and reject a number already registered to
      another tenant. Baileys: write `phoneNumber` and `externalId` when the
      socket opens.
- [ ] Add `archive.ts` (or a PATCH action): only when DISCONNECTED, set
      `archivedAt`; no cascade.
- [ ] Rebuild the Saluran page as a list: label, number, provider, status,
      lease, agent, per-channel actions. "Tambah saluran" opens the provider
      flow. No single `connected` assumption.
- [ ] Gate: a 2-channel plan connects two Cloud API numbers and blocks a
      third; archiving frees a seat and hides the channel; conversations
      survive.

## Phase 3 - Inbox channel awareness

- [ ] Conversation list API includes channel label and number.
- [ ] Conversation row shows a small channel badge; the chat header shows
      the number.
- [ ] Add a channel filter (all plus each channel) to the inbox.
- [ ] Gate: two channels, inbound to each, filter narrows the list; the same
      phone on both channels shows two conversations and one contact.

## Phase 4 - Campaigns and admin

- [ ] Campaign channel selector shows label and number, not just provider.
- [ ] Admin fleet adds label, number and WABA columns; filters by tenant and
      status.
- [ ] Usage and plan limits keep counting CONNECTED channels only.
- [ ] Gate: a campaign targets channel B and sends from B; admin sees the
      full fleet.

## Phase 5 - Verification and rollout

- [ ] Builds: dashboard, admin, api; worker check.
- [ ] Encoding gate.
- [ ] Integration checks: webhook routing by phone number ID, unique
      external ID, limit enforcement, archive, inbox filter.
- [ ] Real second number: Cloud API test number or a second Baileys pairing
      on the clone.
- [ ] Meta cap: surface the 2-number starting cap and the 20-number verified
      cap as a clear error, not a silent failure.
- [ ] Update the status report and tick this plan.

## Files likely touched

- `packages/core/prisma/schema.prisma` + new migration.
- `packages/core/src/types/whatsapp.ts` (channel view shape).
- `apps/dashboard/src/pages/api/dashboard/channels/*` (index, connect,
  disconnect, archive).
- `apps/dashboard/src/pages/dashboard/saluran/index.tsx`.
- `apps/api/src/pages/api/webhooks/whatsapp.ts`.
- `apps/dashboard/src/pages/api/dashboard/inbox/conversations/index.ts` and
  inbox components.
- `apps/dashboard/src/pages/dashboard/campaigns/index.tsx`.
- `apps/admin/src/pages/api/admin/channels.ts` and
  `apps/admin/src/pages/admin/channels.tsx`.
- `apps/worker/src/main.ts` and `packages/core/src/services/baileys.ts` for
  the socket safety cap and startup reconnect.

## Risks

- **Meta cap**: new portfolios allow two numbers, then 20 after
  verification. A plan selling more than two can be blocked by Meta first.
  Show the platform error.
- **Verify token transition**: the legacy per-channel token and the new app
  token can disagree during rollout. Keep the fallback for one release,
  then remove it.
- **Worker memory**: each Baileys socket costs memory. Add a per-instance
  safety cap and log when it is hit.
- **Cross-channel confusion**: two conversations for one contact is correct
  but can confuse staff. The channel badge and filter are required, not
  optional.
- **Data loss**: hard delete would cascade messages and campaigns. Archive
  only.
- **Regression**: the current single-channel page must keep working for
  tenants who never add a second number.

## Decisions to confirm before execution

1. Archive only vs hard delete: recommend archive only.
2. App-level verify token and app secret: recommend yes, with a transition
   fallback.
3. Graph API verification on connect: recommend yes.
4. Label required: recommend yes.
5. Per-channel analytics: defer.

## Explicitly not scheduled

This plan is pending. No schema, API, or UI change should be made until the
owner schedules it.
