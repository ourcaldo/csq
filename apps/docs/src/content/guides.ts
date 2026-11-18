import { API_BASE_URL, DASHBOARD_URL } from "@/lib/docs-data";

// Hand-written guides (server-side content; rendered with react-markdown).
// English, developer-facing. Code samples use the deployment's API base URL.

export type Guide = {
  eyebrow: string;
  title: string;
  description: string;
  markdown: string;
};

const API = API_BASE_URL;

const INTRODUCTION = `The CSQ API lets you drive the platform programmatically: exchange credentials for tokens, list the tools your AI agent can use, and execute those tools against your store's data through the same permission-checked Tool Gateway the agent uses.

Everything lives under one base URL:

\`\`\`text
${API}
\`\`\`

## What you can build

- **Order and product automation** - create orders, update stock, or read catalog data from your own systems.
- **Custom integrations** - connect your POS, ERP, or internal tooling to the same business data the WhatsApp agent reads and writes.
- **Agent operations** - inspect the tool registry and execute any tool the agent is allowed to use.

## Response envelope

Every JSON endpoint returns the same envelope. Successful responses carry \`data\`; failures carry an \`error\` with a machine-readable \`code\` and a human message:

\`\`\`json
{
  "success": true,
  "data": { "items": [] }
}
\`\`\`

\`\`\`json
{
  "success": false,
  "error": { "code": "UNAUTHORIZED", "message": "Bearer token required" }
}
\`\`\`

## Versioning

The product API is versioned in the path (\`/api/v1/...\`). Breaking changes ship under a new version prefix; additive changes can appear within a version.

## Where to go next

- [Quickstart](/quickstart) - mint a key and make your first call.
- [API keys](/authentication) - the credential types and how to manage them.
- [API reference](/reference) - every endpoint, generated from the route contract.`;

const QUICKSTART = `This walks you from zero to a working API call in a couple of minutes.

## 1. Create an API key

Sign in to the CSQ dashboard, open **Settings -> Kunci API**, give the key a name, and click **Buat Kunci**.

The full token is shown **exactly once** - copy it immediately. Only its hash is stored on our side, so a lost token cannot be recovered; you would revoke it and create a new one.

Store the token server-side (environment variable or secret manager). Never ship it in a browser app or mobile binary.

## 2. Make your first request

List the tools registered for your agent:

\`\`\`bash
curl -H "Authorization: Bearer $CSQ_API_KEY" \\
  ${API}/api/v1/tools
\`\`\`

You get an array of tool summaries - name, description, category, and default permission:

\`\`\`json
{
  "success": true,
  "data": [
    {
      "name": "get_product",
      "description": "Look up a product by SKU or name",
      "category": "product",
      "defaultPermission": { "allowed": true, "requiresApproval": false }
    }
  ]
}
\`\`\`

## 3. Execute a tool

Call a tool with your agent's ID and the tool parameters. Parameters are validated server-side by the same schema the agent uses:

\`\`\`bash
curl -X POST "${API}/api/v1/tools/get_product" \\
  -H "Authorization: Bearer $CSQ_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"agentId": "YOUR_AGENT_ID", "params": {"sku": "KOPI-001"}}'
\`\`\`

Find your agent ID in the dashboard (Agent settings). The response is the tool's result, wrapped in the standard envelope.

## 4. Handle errors

Failed calls return HTTP status codes plus the error envelope. Read [Errors & limits](/errors) for the full code table, and [User sessions](/sessions) if you need per-user tokens instead of a tenant key.`;

const AUTHENTICATION = `The API accepts three credential types, all sent as a Bearer token in the \`Authorization\` header.

## Credential types

| Credential | Created in | Use it for |
| --- | --- | --- |
| Tenant API key | Dashboard -> Settings -> Kunci API | Server-to-server integrations for your whole tenant |
| User access JWT | \`POST /api/v1/auth/token\` | Acting as a specific user (short-lived) |
| Service token | Platform environment | Internal platform services only; cannot execute tools |

## Tenant API keys

A tenant API key represents your business, not a person. Rules worth knowing:

- The full token is displayed **once**, at creation. Only a sha256 hash is stored.
- The visible \`prefix\` identifies the key later (in the dashboard and in this API's docs).
- **Revoking is immediate**: any request with a revoked key fails with \`401\`.
- A key belongs to exactly one tenant and can never reach another tenant's data.

\`\`\`bash
curl -H "Authorization: Bearer $CSQ_API_KEY" \\
  ${API}/api/v1/tools
\`\`\`

### Key hygiene

- Keep keys in server-side environment variables or a secret manager.
- Use one key per integration so you can revoke one without breaking others.
- Rotate on a schedule: create the new key, deploy it, revoke the old one.

## Checking what a token can do

Permissions are enforced per tool by the Tool Gateway, not by the token type alone. List the registry (\`GET /api/v1/tools\`) and check each tool's \`defaultPermission\`. A tool that \`requiresApproval\` returns a permission outcome the agent (or your integration) must resolve through the approval flow.

## Next

- [User sessions](/sessions) - the JWT exchange and refresh flow.
- [API reference](/reference) - per-endpoint schemas.`;

const SESSIONS = `User sessions let an integration act as a specific CSQ user. The flow is a standard access/refresh pair.

## Exchange credentials for tokens

\`\`\`bash
curl -X POST "${API}/api/v1/auth/token" \\
  -H "Content-Type: application/json" \\
  -d '{"email": "owner@tokokopi.id", "password": "..."}'
\`\`\`

Response:

\`\`\`json
{
  "success": true,
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "c1b2...",
    "tokenType": "Bearer",
    "expiresIn": 900
  }
}
\`\`\`

- \`accessToken\` - a signed JWT, valid for **15 minutes**. Send it as \`Authorization: Bearer <accessToken>\`.
- \`refreshToken\` - an opaque token, valid for **30 days**. Store it server-side.

Login is rate limited to 5 requests per minute per IP and timing-equalized to reduce credential probing.

## Refresh rotation

Exchange the refresh token for a new pair:

\`\`\`bash
curl -X POST "${API}/api/v1/auth/refresh" \\
  -H "Content-Type: application/json" \\
  -d '{"refreshToken": "$REFRESH_TOKEN"}'
\`\`\`

**Every refresh revokes the presented token.** Replaying a used refresh token returns \`401\` - that is the replay-protection design, not an error to retry. Always persist the new refresh token from the response.

Refresh is rate limited to 20 requests per minute per IP.

## Logout

\`\`\`bash
curl -X POST "${API}/api/v1/auth/logout" \\
  -H "Content-Type: application/json" \\
  -d '{"refreshToken": "$REFRESH_TOKEN"}'
\`\`\`

Logout revokes the refresh token (idempotent - calling it twice is fine). Access tokens are stateless JWTs and expire on their own within 15 minutes.

## When to use which credential

Use a **tenant API key** for server-to-server automation where no specific user context is needed. Use **user sessions** when the integration must act on behalf of a person, or when you are building a client that signs users in.`;

const ERRORS = `## Error envelope

Every failure returns the standard envelope with an HTTP status and a machine-readable code:

\`\`\`json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "params.sku is required"
  }
}
\`\`\`

Branch on \`error.code\`, not on the message text - messages are human-facing and may change.

## Codes

| Code | Typical HTTP | Meaning |
| --- | --- | --- |
| \`UNAUTHORIZED\` | 401 | Missing, invalid, or revoked Bearer token |
| \`PERMISSION_DENIED\` | 403 | Token valid, action not allowed (tool permission, wrong tenant, or service token used for a tenant action) |
| \`VALIDATION_ERROR\` | 400 | Request body or parameters failed schema validation |
| \`NOT_FOUND\` | 404 | Tool or entity does not exist |
| \`METHOD_NOT_ALLOWED\` | 405 | Wrong HTTP method for the endpoint |
| \`INTERNAL_ERROR\` | 500 | Server-side failure; safe to retry with backoff |

## Rate limits

| Endpoint group | Limit |
| --- | --- |
| \`POST /api/v1/auth/token\` | 5 requests / minute / IP |
| \`POST /api/v1/auth/refresh\` | 20 requests / minute / IP |
| Tool execution | 60 requests / minute / API key |
| Meta webhook | Per-IP burst limit |

Exceeding a limit returns \`429\`. Back off exponentially; do not retry in a tight loop.

## Request IDs

Responses carry an \`X-Request-Id\` header. Include it when reporting an issue - it ties the request to server-side logs.

## Retries

Retry on \`429\`, \`500\`, and network timeouts with exponential backoff and jitter. Do **not** retry \`400\`, \`401\`, \`403\`, or \`404\` - the request or credential must change first. A rotated refresh token (\`401\` on refresh) must never be retried; persist the new token instead.`;

const MESSAGES = `Send a WhatsApp message from your own systems through your tenant's connected channel: a text, an image, an image with a caption, or a document. The message appears in the CSQ inbox thread exactly like a reply typed there.

## Text message

\`\`\`bash
curl -X POST "${API}/api/v1/messages" \\
  -H "Authorization: Bearer $CSQ_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "628123456789",
    "channelId": "YOUR_CHANNEL_ID",
    "text": "Halo Kak, pesanan Anda sudah dikirim hari ini.",
    "source": "Placement Test"
  }'
\`\`\`

## Image

\`\`\`bash
curl -X POST "${API}/api/v1/messages" \\
  -H "Authorization: Bearer $CSQ_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "628123456789",
    "channelId": "YOUR_CHANNEL_ID",
    "media": { "url": "https://cdn.example.com/resi.jpg" }
  }'
\`\`\`

## Image with caption

When \`media\` is present, \`text\` becomes the caption - one WhatsApp message, one chat bubble, like sending a photo with a caption by hand.

\`\`\`bash
curl -X POST "${API}/api/v1/messages" \\
  -H "Authorization: Bearer $CSQ_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "628123456789",
    "channelId": "YOUR_CHANNEL_ID",
    "text": "Resi pengiriman Anda, Kak.",
    "media": { "url": "https://cdn.example.com/resi.jpg" }
  }'
\`\`\`

## Document

Send a PDF or other document file. \`media.kind\` must be \`"document"\` and \`filename\` is required - it is the name the customer sees on the chat bubble.

\`\`\`bash
curl -X POST "${API}/api/v1/messages" \\
  -H "Authorization: Bearer $CSQ_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "628123456789",
    "channelId": "YOUR_CHANNEL_ID",
    "text": "Ini brosur harga terbaru kami, Kak.",
    "media": {
      "kind": "document",
      "url": "https://cdn.example.com/price-list.pdf",
      "filename": "price-list.pdf"
    }
  }'
\`\`\`

Response:

\`\`\`json
{
  "success": true,
  "data": {
    "messageId": "...",
    "conversationId": "...",
    "channelId": "...",
    "waMessageId": "..."
  }
}
\`\`\`

\`channelId\` in the response tells you which connected channel sent the message.

## Rules that matter

- **At least one of \`text\` / \`media\` is required.** \`text\` max 4096 characters.
- **\`channelId\` is REQUIRED** - the UUID of the connected channel to send from (tenants can run multiple channels). Copy it from the dashboard's **Saluran** page: the connected-channel card shows a **Channel ID (untuk API)** field with a copy button. A channel outside your tenant gets \`403\`; a disconnected one gets \`409\`.
- **Image media** (\`media.url\` alone, or \`media.kind: "image"\`) must be an HTTPS URL pointing at an image (png, jpeg, webp, gif), max 10 MB. It is downloaded and stored on our side before sending.
- **Document media** (\`media.kind: "document"\`) must be an HTTPS URL to a document file (pdf, doc/docx, xls/xlsx, ppt/pptx, txt), max 10 MB, and \`filename\` is required (max 120 chars, no path separators) - the customer sees it as the bubble's file name.
- **\`source\` (optional, max 80)** labels where the lead came from, e.g. \`"Placement Test"\`. It is stored on the contact and shown on the Pipeline card ("Sumber Lead"). Omit it and a first contact falls back to the API key's name, then \`"API"\`; an existing organic lead keeps its origin. Send the same source on every message from that integration so the label stays stable.
- **24-hour window (Cloud API):** free-form messages are only allowed within 24 hours of the customer's last message. Outside it the API returns \`422 WINDOW_CLOSED\` - an approved template is required for proactive sends. Baileys channels have no such restriction.
- **Takeover:** API sends do NOT reassign the conversation or mute the AI - they count as an answer to the customer message they respond to, and the agent keeps owning the chat. (Dashboard replies never reassign either - assignment changes only through the explicit Ambil alih / Lepas actions.)
- **Rate limit:** 60 requests per minute per credential.
- **Audit:** every send is recorded as \`api.message_send\` in the activity log.

## Errors

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | \`VALIDATION_ERROR\` | Invalid body, or the media URL is not fetchable |
| 403 | \`PERMISSION_DENIED\` | Service token used, or channel outside your tenant |
| 409 | \`NO_CONNECTED_CHANNEL\` | No connected WhatsApp channel |
| 422 | \`WINDOW_CLOSED\` | 24h window closed (Cloud API) |
| 429 | \`RATE_LIMITED\` | 60/min per credential exceeded |
| 502 | \`SEND_FAILED\` | The provider rejected the send |`;

const PIPELINE = `Manage your sales pipeline (the same board as the dashboard's Manajemen Pipeline) from your own systems: list deals, move a lead between stages, set its value, and create new leads.

All endpoints require a tenant API key (or user JWT) and the **pipeline** feature on the tenant's plan. Rate limit: 60 requests per minute per credential.

## Discover the stages

Stage names are per-tenant (defaults: Baru, Tertarik, Penawaran, Pesanan, Menang, Kalah). List them before moving anything:

\`\`\`bash
curl -H "Authorization: Bearer $CSQ_API_KEY" \\
  ${API}/api/v1/pipeline/stages
\`\`\`

\`\`\`json
{
  "success": true,
  "data": {
    "items": [
      { "id": "...", "name": "Baru", "kind": "OPENING", "order": 1 },
      { "id": "...", "name": "Menang", "kind": "WON", "order": 5 }
    ]
  }
}
\`\`\`

## List deals

\`\`\`bash
curl -H "Authorization: Bearer $CSQ_API_KEY" \\
  "${API}/api/v1/pipeline/deals?stage=Baru&pageSize=50"
\`\`\`

Each item carries the deal's stage, value, the customer's phone, the contact name and \`source\` (where the lead came from, e.g. "Placement Test"), the assignee, and tags. Optional filters: \`stage\` (name), \`assignee\` (user UUID), \`tag\` (name), \`from\`/\`to\` (chat-activity ISO dates), \`page\`/\`pageSize\` (max 100).

## Move a lead / set its value

\`PATCH\` with the deal's \`conversationId\` (it is in every list item and in the response of a message send):

\`\`\`bash
curl -X PATCH -H "Authorization: Bearer $CSQ_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "stage": "Penawaran", "value": 250000, "reason": "placement test completed" }' \\
  ${API}/api/v1/pipeline/deals/CONVERSATION_ID
\`\`\`

- \`stage\` is matched by name, case-insensitive. Terminal stages (**Menang** / **Kalah**) cannot be moved out of; moving INTO them is allowed.
- \`value\` is whole rupiah (0 to 1,000,000,000,000). \`0\` clears the display on the card.
- \`reason\` (max 300) lands in the stage history row - tag it with your integration's name so its moves are identifiable.
- At least one of \`stage\` / \`value\` per call. Both land in the same audit trail (\`deal.stage_change\` / \`deal.value_change\`) as a dashboard move.

## Create a lead

\`\`\`bash
curl -X POST -H "Authorization: Bearer $CSQ_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "phone": "08123456789", "name": "Budi", "stage": "Tertarik", "value": 250000 }' \\
  ${API}/api/v1/pipeline/deals
\`\`\`

- \`phone\` is normalized like the dashboard's Tambah Lead dialog: \`08xx\` becomes \`628xx\`. A number that already has a conversation reuses its deal instead of creating a duplicate.
- \`stage\` defaults to the first stage (Baru); \`name\` and \`value\` are optional.
- The contact's source gets \`"Input Manual"\` only if empty - to record a labeled origin, send the first message through [POST /api/v1/messages](/messages) with a \`source\` first.

## Placement test example

1. The student submits the placement test on your site.
2. \`POST /api/v1/messages\` with \`"source": "Placement Test"\` - the lead appears on the pipeline labeled with its origin.
3. When the result is graded, \`PATCH /api/v1/pipeline/deals/{conversationId}\` with \`{"stage": "Tertarik"}\` (or wherever your flow puts it) and optionally the course price as \`value\`.

## Errors

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | \`VALIDATION_ERROR\` | Invalid body or query, bad phone |
| 401 | \`UNAUTHORIZED\` | Missing or invalid Bearer token |
| 403 | \`PERMISSION_DENIED\` | Service token used |
| 403 | \`FEATURE_DISABLED\` | The pipeline feature is not on the tenant's plan |
| 404 | \`NOT_FOUND\` | Unknown stage/tag name, or conversation outside your tenant |
| 429 | \`RATE_LIMITED\` | 60/min per credential exceeded |`;

export const GUIDES: Record<string, Guide> = {
  introduction: {
    eyebrow: "Get started",
    title: "Introduction",
    description:
      "The CSQ API for programmatic access to your WhatsApp AI agent and your store's business data.",
    markdown: INTRODUCTION,
  },
  quickstart: {
    eyebrow: "Get started",
    title: "Quickstart",
    description: "Mint an API key and make your first call in a couple of minutes.",
    markdown: QUICKSTART,
  },
  authentication: {
    eyebrow: "Authentication",
    title: "API keys",
    description: "The credential types the API accepts, and how to manage tenant API keys.",
    markdown: AUTHENTICATION,
  },
  sessions: {
    eyebrow: "Authentication",
    title: "User sessions",
    description: "Exchange user credentials for short-lived access tokens and rotate refresh tokens.",
    markdown: SESSIONS,
  },
  errors: {
    eyebrow: "Guides",
    title: "Errors & limits",
    description: "The error envelope, code table, rate limits, and retry guidance.",
    markdown: ERRORS,
  },
  messages: {
    eyebrow: "Guides",
    title: "Sending messages",
    description:
      "Send a text, an image, or an image with a caption through your tenant's connected WhatsApp channel.",
    markdown: MESSAGES,
  },
  pipeline: {
    eyebrow: "Guides",
    title: "Managing the pipeline",
    description:
      "List deals, move a lead between stages, set its value, and create leads - the dashboard's Manajemen Pipeline over the API.",
    markdown: PIPELINE,
  },
};

export { DASHBOARD_URL };
