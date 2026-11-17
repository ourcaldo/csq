# 25. Pipeline Management API (owner request 2026-11-17)

The public API (`/api/v1`) can send messages but cannot manage the sales
pipeline: listing deals, moving a lead's stage, setting its value, or
creating a lead. Today only the dashboard (session-auth BFF) and the AI
tool can. A tenant's own software - e.g. the placement-test integration
that already labels its leads with `source` (PRD 24) - has no door.

This PRD adds pipeline endpoints under `/api/v1/pipeline/*`. They reuse
the SAME `@csq/core` pipeline functions the dashboard's drawer and the
"Tambah Lead" dialog use, so behavior, history rows, and audit trails
are identical - no duplicated logic.

## Endpoints

All: Bearer auth - tenant API key or user access JWT (service tokens get
403, same as PRD 24). Rate limit: 60 requests per minute per credential.
Requires the tenant's `pipeline` feature flag (as the dashboard does).

### 1. `GET /api/v1/pipeline/deals` - list the board

Query parameters (all optional):

| Param | Type | Meaning |
| --- | --- | --- |
| `stage` | string | Stage name, e.g. `Baru` (case-insensitive match) |
| `assignee` | user UUID | Filter by PIC |
| `tag` | string | Filter by tag name |
| `from` / `to` | ISO date | Chat-activity range (`lastMessageAt`) |
| `page` / `pageSize` | int | Pagination (defaults 1 / 50, max 100) |

Response `200`:

```json
{
  "items": [
    {
      "id": "deal uuid",
      "conversationId": "conversation uuid",
      "value": 250000,
      "stage": { "id": "...", "name": "Baru", "kind": "OPENING" },
      "conversation": {
        "customerPhone": "628123456789",
        "lastMessageAt": "2026-11-16T04:21:55.542Z",
        "contact": { "name": null, "phone": "628123456789", "source": "Placement Test" },
        "assignee": { "id": "...", "name": "Aldo", "email": "..." },
        "tags": [{ "tag": { "id": "...", "name": "Hot" } }]
      }
    }
  ],
  "total": 18,
  "page": 1,
  "pageSize": 50
}
```

`GET /api/v1/pipeline/stages` - the tenant's stages (id, name, kind,
order), so a caller can discover valid stage names before moving
anything. Cheaper than guessing and failing.

### 2. `PATCH /api/v1/pipeline/deals/{conversationId}` - move stage / set value

Request body (at least one of `stage` / `value`, same contract as the
drawer's PATCH):

```json
{
  "stage": "Penawaran",
  "value": 250000,
  "reason": "moved by placement-test integration"
}
```

- `stage` (optional) - target stage NAME, case-insensitive. Terminal
  stages (Menang/Kalah) cannot be moved out of; moving INTO them is
  allowed. A conversation without a deal gets one lazily (same as the
  dashboard PATCH).
- `value` (optional, whole rupiah, 0 - 1e12) - estimated deal value.
  Sending `0` clears the display; the field is never negative.
- `reason` (optional, max 300) - free text, lands in the stage history
  row so integrations can identify their own moves.

Response `200`:

```json
{ "dealId": "...", "stageId": "...", "value": 250000 }
```

Behavior identical to the dashboard PATCH: `DealStageHistory` row +
`deal.stage_change` audit on a real transition, `deal.value_change`
audit on a value set, tenant-scoped (a conversation outside the token's
tenant is 404). API-key callers leave `movedByUserId` null (there is no
user); the audit trail carries the credential in the reason context.

### 3. `POST /api/v1/pipeline/deals` - create a lead

Same as the dashboard's "Tambah Lead": find-or-create the conversation
by phone, ensure the deal at the given (or first) stage, set name and
value when provided. The contact's `source` gets `"Input Manual"`
only-if-empty (existing origin sticks); send `POST /api/v1/messages`
with `source` first when a labeled origin matters.

Request:

```json
{
  "phone": "628123456789",
  "name": "Budi",
  "stage": "Tertarik",
  "value": 250000
}
```

- `phone` (required) - `08xx` normalized to `628xx`, same as the
  dashboard dialog. An existing conversation for the number reuses its
  deal instead of duplicating.
- `name` / `stage` / `value` optional.

Response `200`:

```json
{ "conversationId": "...", "dealId": "...", "created": true }
```

## Errors (shared)

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Invalid body/query (unknown stage name, bad phone) |
| 401 | `UNAUTHORIZED` | Missing/invalid Bearer token |
| 403 | `PERMISSION_DENIED` | Service token used, or pipeline feature off for tenant |
| 404 | `NOT_FOUND` | Conversation/deal outside the tenant, or unknown stage name in body |
| 429 | `RATE_LIMITED` | 60/min per credential exceeded |

`FEATURE_DISABLED` (plan-gated) uses 403 with a clear message, same as
the dashboard's feature guard.

## Non-goals

- No stage CRUD (rename/add/delete stages) - dashboard-only for now.
- No tag management, no assignment (PIC) via API - follow-up if asked.
- No per-deal history read endpoint yet; the stage history stays
  dashboard-side until a caller needs it.

## Documentation

Contract lives in `api-contract.ts` (generated reference + OpenAPI
cannot drift) plus a "Managing the pipeline" guide in `apps/docs` with
the placement-test example: send with `source`, then PATCH the stage
when the test result arrives.
