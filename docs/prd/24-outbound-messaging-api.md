# 24. Outbound Messaging API (owner decision 2026-11-15)

The public API (`/api/v1`) could not send WhatsApp messages: the dashboard
inbox, the agent loop, and campaigns could, but tenant systems had no
door. This PRD adds `POST /api/v1/messages` so a tenant's own software can
send a text, an image, or an image with a caption, with the SAME behavior
as a reply typed in the CRM dashboard.

## Endpoint

`POST /api/v1/messages` - Bearer auth: tenant API key or user access JWT
(service tokens get 403; they are platform-internal and not tenant-bound).
Rate limit: 60 requests per minute per credential.

Request:

```json
{
  "to": "628123456789",
  "text": "Halo Kak, pesanan Anda sudah dikirim.",
  "media": { "url": "https://cdn.example.com/resi.jpg" },
  "channelId": "uuid (required)"
}
```

- `to` (required) - customer phone, digits with optional leading `+`;
  normalized to the same conversation identity the inbox uses.
- `text` (optional, max 4096) - the message body. When `media` is present
  it becomes the caption (one WhatsApp message, like a dashboard reply
  with a photo and a caption).
- `media.url` (optional) - HTTPS image URL (png/jpeg/webp/gif, max 10 MB).
  Downloaded server-side and stored as a MediaAsset, served from the API
  service for the Cloud API media fetch.
- `channelId` (REQUIRED - amendment 2026-11-15, owner decision): the
  connected channel to send from. No implicit "first connected channel"
  fallback: tenants will run multiple channels (PRD 15), so the sender is
  always explicit. The dashboard's Saluran page shows the channel ID on
  the connected-channel card with a copy button.
- At least one of `text` / `media` is required.

Response `200`:

```json
{ "messageId": "...", "conversationId": "...", "waMessageId": "..." }
```

## Behavior (mirrors the CRM dashboard reply)

1. **Channel** - `channelId` is required and must belong to the token's
   tenant (`403` otherwise) and be CONNECTED (`409 NO_CONNECTED_CHANNEL`
   otherwise). No default-channel fallback (amendment 2026-11-15).
2. **Media** is fetched and stored before any send; invalid or oversized
   media fails with `400` and nothing is sent.
3. **Conversation** is ensured for (tenant, customer phone) through the
   same find-or-create path as inbound: a RESOLVED conversation reopens;
   PENDING is untouched.
4. **24-hour window (Cloud API only)** - free-form sends are allowed only
   within 24 hours of the customer's last inbound message. Outside the
   window the endpoint returns `422 WINDOW_CLOSED` with a clear message
   (approved templates are out of scope for v1). Baileys has no such
   enforcement, exactly like the dashboard today.
5. **Send path**: web processes hold no WhatsApp socket, so the send goes
   through the worker's outbox (the same queue every dashboard reply
   uses). `OutboundMessage` gains `mediaId`; the worker sends an image
   (with `body` as caption) or a text.
6. **Recording**: the send is recorded as an OUTBOUND message in the
   conversation - `senderType API` (amendment 2026-11-15: the inbox labels
   it "API"; it is not an unnamed human reply), `senderUserId` = the JWT
   user when the caller authenticated with a user token (null for API
   keys), `kind MEDIA` + `mediaId` for image sends. `lastMessageAt`
   updates and the send is audited as `api.message_send`. It appears in
   the inbox thread like any other reply and counts as an answer to the
   customer message it responds to. When the send creates the conversation
   (first contact with that number), the conversation also lands on the
   pipeline's first stage (amendment 2026-11-16, PRD 03 15.8) - the
   Pipeline board shows leads, and an outbound-only chat is a lead too.
7. **Decision - no AI stand-down, no reassignment.** A dashboard human
   reply takes the conversation over (reply-as-takeover, PRD 03 amendment
   2026-11-10). API sends are automation, not a person typing: they count
   as an answer (the agent will not double-reply to the customer message
   they respond to), but the AI keeps owning the conversation. Rationale:
   a notification send (e.g. "order shipped") must not silently mute the
   AI for that customer. Tenants who want takeover semantics reply from
   the dashboard.

## Errors

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Invalid body or media URL/image |
| 401 | `UNAUTHORIZED` | Missing/invalid Bearer token |
| 403 | `PERMISSION_DENIED` | Service token used, or channel outside the tenant |
| 409 | `NO_CONNECTED_CHANNEL` | No connected WhatsApp channel |
| 422 | `WINDOW_CLOSED` | Cloud API 24h window closed; template required |
| 429 | `RATE_LIMITED` | 60/min per credential exceeded |
| 502 | `SEND_FAILED` | Provider send failed (error carried in the message) |

## Out of scope (v1)

- Approved templates outside the 24h window (future `template` object).
- Video, audio, documents, multiple images (images only, one per call).
- Scheduling and bulk sends (campaigns own that).
- Delivery-status webhooks.

## Documentation

The endpoint appears in the generated API reference (contract-driven,
cannot drift) plus a hand-written "Sending messages" guide in
`apps/docs` covering the three shapes (text / image / image+caption), the
24h rule, and the inbox/takeover semantics above.
