# 23D. Deferred Engineering Items Register (owner decision 2026-11-08)

Status: no DEFERRED items remain. Every deferred item was completed on owner
direction 2026-11-09, ahead of its original trigger. Multi-channel is PENDING
(not deferred): it is recorded so it is never forgotten, and work starts only
when the owner schedules it. The anti-"not-today" rule cuts both ways:
deferral here is a forward-looking decision with named reasons, never a
dismissal.

| Item | What it is | Status | Trigger |
|---|---|---|---|
| Page-splitting (saluran, campaigns, agents) | Break the 500-900 line pages into components | DONE 2026-11-09 - saluran 939 to 441, campaigns 822 to 398, agents 558 to 225 lines; components under `components/dashboard/{channels,campaigns,agents}` | n/a - owner direction 2026-11-09 |
| SWR-style inbox client cache | Stable references + dedupe for the polled conversation list | DONE 2026-11-09 - `usePolledApi`: in-flight dedupe, previous data kept during revalidation, same object reference when the payload is unchanged | n/a - owner direction 2026-11-09 |
| Api-keys management UI | Dashboard page over the existing mint/list/revoke routes | DONE 2026-11-08 - built as `/admin/api-keys` in the admin console (PRD 13 Phase 4) | n/a - no longer deferred |
| Docker Compose for api + worker | VPS deploy path for the new services | DONE 2026-11-09 - multi-target `docker/Dockerfile` (dashboard/api/worker), api + worker compose services, nginx routes, setup-vps pull path. Image build not executed locally (Docker absent); compose YAML and the API standalone build verified | n/a - owner direction 2026-11-09 |
| Generated OpenAPI | Spec generated from route schemas instead of hand-written | DONE 2026-11-09 - generated from `apps/api/src/lib/api-contract.ts`; `npm run check:openapi`; live `/api/v1/openapi` serves 7 paths | n/a - no longer deferred |
| Multiple channels per tenant | More than one WhatsApp number in one tenant: channel identity, app-level webhook token, Saluran list, inbox filter | PENDING 2026-11-09 - owner direction recorded, not scheduled (PRD 15) | Owner schedules the multi-channel plan |
| Cross-service metrics + alerting | One health view of dashboard + api + worker, alerts on failure | DONE 2026-11-09 - admin console Overview is the health VIEW; `scripts/alert-check.ts` probes dashboard + api + worker + a worker heartbeat (SystemLock, 90s TTL) and posts to `ALERT_WEBHOOK_URL` with a 30-minute same-failure cooldown; `npm run check:alerts` | n/a - owner direction 2026-11-09 |
| packages/ui shared components | Extract duplicated base components into a workspace package | DONE 2026-11-08 - extraction complete; adoption cleanup tracked separately | n/a - no longer deferred |
| Shared UI adoption cleanup | Upgrade `@csq/ui` Dialog (focus trap, scroll lock) and adopt it in the admin and plan modals; use shared Select/Card where only classes differ | DONE 2026-11-09 - Dialog upgraded, 7 modals adopted, 4 admin selects, admin Card wraps the shared Card | n/a - no longer deferred |

The pre-cutover package is down to scheduling the smoke suite
(`scripts/smoke-test.ts`) and the alert check against production. The
metrics/alerting half was built on owner direction 2026-11-09. Detailed
register with scope estimates and acceptance criteria:
`docs/report/2026-11-08-deferred-items-register.md`.

------------------------------------------------------------------------

