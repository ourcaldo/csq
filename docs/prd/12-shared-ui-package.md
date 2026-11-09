# 12. Shared UI Package (owner decision 2026-11-08)

The duplicated design-system layer becomes a workspace package,
`packages/ui` (`@csq/ui`). This fires deferred register item 7 (file 09)
early by owner direction - its "third app" trigger had not technically
fired, but the divergence cost is already real (web's globals.css ships
landing/inbox styles it never renders) and the admin console approaches.

## What is shared - the design-system layer

- `cn()` (clsx + tailwind-merge) - the component-class foundation.
- Every shadcn/ui primitive currently in the dashboard: badge, button,
  card, dialog, input, label, select, separator, switch, table, textarea.
- `Seo` - the head/OpenGraph/JSON-LD component both apps already use.
- The shared Tailwind theme (design tokens: colors, radius, keyframes,
  plugins) exported as a preset each app's config extends.
- The CSS base layer: the shared `:root` theme variables. Dated note
  2026-11-09 (PRD 16 DOC-7): the `@tailwind` directives stay app-local in
  each app's `globals.css` (each app owns its Tailwind pipeline); only the
  `:root` variables are shared from the package.

## What is NOT shared - app-local by design

Sharing these would over-couple the apps; their duplication is correct
and stays:

- `_document.tsx` - fonts, language, and metadata are per-app presentation
  choices (web needs the landing display fonts; dashboard does not).
- App-specific CSS - the dashboard keeps inbox-bubble and scenario
  styles, web keeps landing animations. Only the theme-variable base is
  shared; the app layers stay per-app.
- Public/static assets (`icon.svg`, `og.svg`) - each app serves its own.
- `types/next-auth.d.ts` - stays per-app (dashboard + api) until a third
  copy exists; core may own it later with a per-app tsconfig include.

## Rules

- Apps import `@csq/ui/...`. `@csq/ui` never imports from an app, never
  imports `@csq/core` (presentation only), and never talks to the
  database.
- App-specific components stay app-local. A NEW component is copy-pasted
  once and extracted into `@csq/ui` on the third app or second real
  caller - the existing repo rule continues to govern new code.
- The encoding guard covers `packages/ui`.

## Audit 2026-11-09 (post-extraction)

The extraction is complete as scoped: `cn`, all 11 primitives, `Seo`, the
preset and the theme live in `@csq/ui`; the dashboard imports them; web uses
`cn`, `Seo`, the preset and the theme; no app imports cross the boundary and
there are no local `seo` or `utils` copies left.

Adoption cleanup (2026-11-09, second pass):

- Shared `Dialog` now has a focus trap, body scroll lock, focus restore,
  Escape and backdrop close, and an accessible name (`ariaLabel` for custom
  headers). The grey scrim stays removed.
- All 5 admin modals (tenants, plans, admins, invoice create, mark paid)
  and both tenant plan modals (cara bayar, paket) use the shared Dialog.
- The 4 admin raw selects use the shared Select.
- The admin `Card` wraps the shared Card instead of duplicating its markup.
- App-local Ledger compositions (`Btn`, `Status`, `Empty`, `Stat`,
  `PageHead`, `Tag`, `Group`) stay local by design; the dashboard and web
  compositions stay local too.
- The dashboard still builds some card surfaces from divs; that is
  composition, not a primitive duplicate, and stays.

Rule going forward: a new modal uses the shared Dialog; a new
primitive-looking control uses the shared primitive; app-specific
compositions stay local.

## Execution

Phased plan with acceptance criteria:
`docs/plans/2026-11-08-shared-ui-package-plan.md`.
