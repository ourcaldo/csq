# 23D. Deferred Engineering Items Register (owner decision 2026-11-08)

Formal status: DEFERRED. These items are recorded so they are never
forgotten and never built early. Each has a trigger; work starts when its
trigger fires, not before. Building a deferred item before its trigger is
scope creep - and the anti-"not-today" rule cuts both ways: deferral here
is a forward-looking decision with named reasons, never a dismissal.

| Item | What it is | Status | Trigger |
|---|---|---|---|
| Page-splitting (saluran, campaigns, agents) | Break the 500-900 line pages into components | DEFERRED | Next feature work on those pages |
| SWR-style inbox client cache | Stable references + dedupe for the polled conversation list | DEFERRED | Inbox jank under real traffic |
| Api-keys management UI | Dashboard page over the existing mint/list/revoke routes | DONE 2026-11-08 - built as `/admin/api-keys` in the admin console (PRD 13 Phase 4) | n/a - no longer deferred |
| Docker Compose for api + worker | VPS deploy path for the new services | DEFERRED | VPS deployment becomes real (Render stays = never) |
| Generated OpenAPI | Spec generated from route schemas instead of hand-written | DEFERRED | /api/v1 grows past the current surface |
| Multiple channels per tenant | More than one WhatsApp number in one tenant: channel identity, app-level webhook token, Saluran list, inbox filter | PENDING 2026-11-09 - owner direction recorded, not scheduled (PRD 15) | Owner schedules the multi-channel plan |
| Cross-service metrics + alerting | One health view of dashboard + api + worker, alerts on failure | SPLIT 2026-11-08 - the admin console Overview (PRD 13) provides the health VIEW; the alerting half stays REQUIRED at cutover | The production cutover decision (alerting half) |
| packages/ui shared components | Extract duplicated base components into a workspace package | DONE 2026-11-08 - extraction complete; adoption cleanup tracked separately | n/a - no longer deferred |
| Shared UI adoption cleanup | Upgrade `@csq/ui` Dialog (focus trap, scroll lock) and adopt it in the admin and plan modals; use shared Select/Card where only classes differ | DEFERRED | Next UI work touching those surfaces |

The pre-cutover package (metrics/alerting + the smoke suite on a schedule)
is the one bundle that activates automatically with the owner's cutover
decision. Detailed register with scope estimates and acceptance criteria:
`docs/report/2026-11-08-deferred-items-register.md`.

------------------------------------------------------------------------

