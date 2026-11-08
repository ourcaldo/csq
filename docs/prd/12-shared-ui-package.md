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
- The CSS base layer: the `@tailwind` directives plus the `:root` theme
  variables.

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

## Execution

Phased plan with acceptance criteria:
`docs/2026-11-08-shared-ui-package-plan.md`.
