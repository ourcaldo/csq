# Pipeline Management Revamp - Plan (2026-11-16)

Owner request: "revamp the Manajemen Pipeline as it's quite bad for me", reference
`docs/assets/csq_pipeline_management_revamp.html` (static mockup). The page keeps its
existing capabilities (kanban drag, funnel, filters, stage management) and gains the
reference's sales-board affordances.

## Scope

1. **Deal value** - the mockup's "Potensi Nilai Pipeline" and per-card value need a
   field the schema does not have. Add `Deal.value Int @default(0)` (whole rupiah;
   IDR has no practical minor unit). Editable from the drawer, shown on cards and
   stage totals.
2. **Rich cards** - phone + unread badge, contact name, last-message snippet, last
   activity, first tag, value, assignee.
3. **Column header** - stage color dot, count, total value for that stage.
4. **Header stats** - active customers badge + total pipeline value.
5. **Slide-over drawer** (replaces the cramped dialog) - stage selector, editable
   value, last-message preview, quick reply (same send path as the inbox), contact
   info (phone, PIC, channel source, tags), contact note (save on blur), and the
   Buka Kontak / Buka Chat actions.
6. **Tambah Lead** - manual lead entry (phone, name, stage, value) on top of
   `findOrCreateConversation` + `setConversationStage`.
7. **Reset filters** + toast feedback.

Out of scope: funnel redesign, per-deal history view, editing tags from the drawer
(the inbox owns tagging), AI setting the value.

## Data and API

- `Deal.value` + migration `20261116100000_deal_value`.
- `GET /api/dashboard/pipeline/deals`: returns `PipelineDeal[]` (serialized client
  shape), `valueTotal` for the stage, and `unreadCount` per card. Unread is one
  grouped query (watermarks + OR of per-conversation conditions), not N+1.
- `PATCH /api/dashboard/pipeline/deals/[conversationId]`: `{ stage?, value? }`,
  at least one required. Stage path unchanged (`setConversationStage`); value is
  audited as `deal.value_change`.
- `POST /api/dashboard/pipeline/deals`: `{ phone, name?, stage, value? }` -
  normalizes the phone (08xx -> 628xx), uses the tenant's connected channel,
  creates or reuses the conversation, places the deal, sets the value.
- Drawer reuses existing endpoints: conversation messages (GET/POST reply),
  contact PATCH (`notes`), tags are read from the deal payload.

## Verification

- `npm run build` + `npm run check:encoding`.
- Run the dashboard locally against the clone DB, log in as the demo tenant owner,
  and check the rendered board, drawer, quick reply, stage/value edits, and Tambah
  Lead (values persisted, columns reload).

## Checklist

- [x] Schema + migration applied to the clone
- [x] Core: deal value, list query (channel/tags/last message/value total), value setter, manual lead
- [x] API: list/PATCH/POST
- [x] UI: page revamp + drawer + add-lead dialog + toast
- [x] PRD 03 amendment + changelog + version bump
- [x] Build, local visual verification, deploy
