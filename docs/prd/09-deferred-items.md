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
| Api-keys management UI | Dashboard page over the existing mint/list/revoke routes | DEFERRED | First real API consumer, or the admin console |
| Docker Compose for api + worker | VPS deploy path for the new services | DEFERRED | VPS deployment becomes real (Render stays = never) |
| Generated OpenAPI | Spec generated from route schemas instead of hand-written | DEFERRED | /api/v1 grows past the current surface |
| Cross-service metrics + alerting | One health view of dashboard + api + worker, alerts on failure | DEFERRED - becomes REQUIRED at cutover | The production cutover decision |
| packages/ui shared components | Extract duplicated base components into a workspace package | DEFERRED | The third app needs them (extract-on-third rule) |

The pre-cutover package (metrics/alerting + the smoke suite on a schedule)
is the one bundle that activates automatically with the owner's cutover
decision. Detailed register with scope estimates and acceptance criteria:
`docs/2026-11-08-deferred-items-register.md`.

------------------------------------------------------------------------

