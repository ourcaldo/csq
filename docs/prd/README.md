# PRD - Document Set

The product requirements live as focused documents, one per concern - not
one monolithic file. Split from the original single PRD on 2026-11-08 at
the owner's direction; content moved unchanged (line-exact), so old
section references like "PRD 23C" remain valid - the numbers are kept in
the file contents and names.

## Reading order

| File | Old sections | What it holds | Status |
|---|---|---|---|
| `01-product-foundation.md` | 1-7 | Vision, users, multi-business model, agent model, business context | Historical MVP spec + live constraints |
| `02-data-and-capabilities.md` | 8-13 | Data sources, capability model, read vs write, write ops, data authority | Live |
| `03-agent-dashboard-tools-security.md` | 14-18 | CS agent behavior, dashboard, approvals, tool architecture, security requirements | Live |
| `04-mvp-scope.md` | 19, 20, 20A | HackFest MVP scope, explicitly out of scope, marketing pages | Live (scope governs until a section is superseded) |
| `05-demo-metrics-deployment.md` | 21, 22, 22A | Demo script, success metrics, self-hosted deployment model | Live |
| `06-technical-architecture.md` | 23, 23A | Architecture decisions, technology stack | Live; some single-process statements superseded by 08 |
| `07-project-structure-monorepo.md` | 23B | Monorepo escalation (23B.0) + scaffolding plan | Live |
| `08-enterprise-architecture.md` | 23C | Service topology, token realms, resilience isolation | Live - governs current architecture |
| `09-deferred-items.md` | 23D | Deferred engineering items register (status: DEFERRED + triggers) | Live |
| `10-positioning-future.md` | 24-29 | Differentiation, principles, future expansion | Live |
| `11-campaigns-classification.md` | 30 | Contact classification + campaigns feature PRD | Live |
| `12-shared-ui-package.md` | new | The `@csq/ui` shared design-system package - what is shared, what stays app-local | Live |
| `13-admin-console.md` | new | The SaaS-operator section: platform admin console - menus, suspension semantics, separate auth realm, deferred-beyond-v1 list | Live - console deployed; deferred list updated 2026-11-09 |
| `14-plans-billing-quotas.md` | new | Packages, billing, quotas: entitlements, credit ledger, MAU, invoices, plan requests, tenant Paket & Kuota | Live - verification tracked in the plan |
| `15-multi-channel.md` | new | Multiple WhatsApp channels per tenant: channel identity, connect flow, webhook routing, inbox, limits | Pending - not scheduled |

Companion working documents (plans, registers, status) stay in `docs/`
with date prefixes, e.g. `docs/plans/2026-11-08-enterprise-architecture-plan.md`.

## Conventions

- A new product decision gets either its own focused file here, or a
  dated amendment inside the file it concerns - never a new dump.
- Superseded statements are marked in place with dated notes, never
  silently rewritten.
- The changelog (`Changelogs.md`) records releases; this set records the
  product. Do not mix the two.
