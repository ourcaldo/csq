# 30. Contact Classification & Campaigns (2026-11-01)

Full design, owner decisions, and verification record:
`docs/2026-11-01-feature-plan-contact-tags-and-campaigns.md`. This section states the requirements.

## 30.1 Contact tags and categories

A contact may belong to **multiple categories** and carry **multiple tags**; both are
tenant-scoped taxonomies managed by the OWNER (a "Kategori Kontak" section shares the Tag page).
Contacts can be filtered by category and tag, classified from the contacts page or directly in
the inbox contact panel, and both classifications are campaign targeting axes. Category/tag
names are unique per tenant; deleting one detaches contacts, never deletes them.

## 30.2 Campaigns (message blasting)

The OWNER (or a STAFF member the owner grants the per-staff campaign toggle on the Team page)
creates a campaign: a name, a WhatsApp channel, an audience (all contacts / one or more
categories / one or more tags / a hand-picked list), a message (from the internal template
library or fresh text, with up to 4 uploaded images), a schedule (once at a time, daily, weekly,
monthly, or every N days, interpreted in the platform schedule timezone), and a pacing delay
between contacts. Each fire creates a run with one per-recipient row, so a blast survives
restarts, never double-sends, and shows a per-recipient delivery log with statuses and skip
reasons.

Campaign send policy — verified against Meta's documentation (see the plan's round-3 record):

- **Cloud API (official):** free-form text/images reach recipients only inside the 24-hour
  customer-service window; outside it Meta's API accepts only a pre-approved template, so a
  free-form campaign skips those recipients with a logged reason, or the campaign may attach
  an approved template which Meta delivers to them as a normal message.
- **Baileys (own number):** internal template content is delivered as normal messages to every
  recipient, no Meta templates involved.

WhatsApp bills per delivered message (including in-window service replies since 2026-10-01,
with a 1,000/month free tier per number), and out-of-window sends are additionally capped by the
portfolio's messaging limit (250 -> 2,000 -> auto-scaling) — the campaign wizard surfaces the
audience count and warnings.

## 30.3 Out of scope for campaigns v1

In-window interactive buttons (Cloud API), media deletion/cleanup, a general permission
matrix, drip sequences (multi-step campaigns), and campaign analytics beyond run counts.
