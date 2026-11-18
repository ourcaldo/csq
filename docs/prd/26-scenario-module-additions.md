# 26. Scenario Module Additions (2026-11-18)

Owner request 2026-11-18, three additions to the scenario (automation) module
and the inbox. All on branch `monorepo` (testing stack).

## 26.1 Trigger: handoff to a human agent

`ON_HANDOFF` ("Dialihkan ke agen manusia") starts a scenario run when a chat is
transferred to a human. It fires on all three handoff paths:

- the AI agent's `conversation.handoff` tool (customer asks for a human),
- the dashboard assignment picker (`assignConversation`),
- the AI-failure escalation (retries exhausted, conversation lands on the owner).

A transfer to a human counts; assigning back to the AI or clearing the
assignment never fires. Run dedup key is `conversationId:assigneeUserId`, so the
same handoff cannot double-fire but a later transfer to a *different* human can
re-run the scenario. The worker process now registers the scenario engine
(previously only the dashboard and api did), so event-bus triggers emitted from
Baileys-side code (inbound, handoff tool) actually fire there.

## 26.2 Send module: arbitrary destination

The Kirim Pesan node gains an optional `to` field (Tujuan). Empty = the
conversation's customer (unchanged behavior). A WhatsApp number in it sends the
message to that number instead: the number is normalized (08xx to 628xx, same
rule as campaigns), a conversation is find-or-created for the destination on
the same channel, and the message is recorded on the destination's thread. The
Cloud API 24h window is checked against the destination's thread (skip + audit
on closed window, never a silent drop). `{{variable}}` tags are interpolated in
`to` as well, so `{{customer_phone}}` resolves to the run's customer.

## 26.3 Template picker in the conversation panel

The inbox chat panel's Template button previously required hand-typing the name
of a Meta-approved template. It now lists the tenant's saved templates
(Template Pesan page, `Tenant.settings.messageTemplates`):

- **CSQ kind** (free text the owner wrote): sent as a normal reply through the
  regular send path - the 24h Cloud API window applies, same as typing it.
- **META kind** (name of a template approved in Meta Business Manager): sent
  through the template route - the only compliant path outside the 24h window.

No new template storage was added; both kinds already exist on the Template
Pesan page.
