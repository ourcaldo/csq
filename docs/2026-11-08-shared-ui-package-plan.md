# Shared UI Package Plan (PRD 12)

Date: 2026-11-08
Owner decision: extract the duplicated design-system layer into
`packages/ui` (`@csq/ui`). PRD: `docs/prd/12-shared-ui-package.md` (which
also records the honest boundary - what is NOT shared and why). This
activates deferred register item 7 early.

## Scope

IN: `cn`, the 10 shadcn/ui primitives, `Seo`, the shared Tailwind theme
preset, the CSS base layer, and the UI-only dependencies
(class-variance-authority, clsx, tailwind-merge, @radix-ui/react-slot).

OUT (stay app-local per the PRD): `_document.tsx`, app-specific CSS
sections, public/static assets, `types/next-auth.d.ts`.

## Steps (one branch, each step leaves the build green)

1. **Create `packages/ui`** as a workspace package:
   - `package.json`: name `@csq/ui`, the four UI deps. No tsconfig of its
     own - the root tsconfig paths mechanism (as with `@csq/core`) serves
     it.
   - `src/lib/utils.ts` (cn, moved from dashboard), `src/components/seo.tsx`
     (moved), `src/components/ui/*.tsx` (the 10 primitives, moved).
   - `src/styles/base.css`: the `@tailwind` directives + the `@layer base`
     `:root` theme variables, moved from dashboard's globals.css.
   - `src/tailwind-preset.cjs`: the shared theme (colors, borderRadius,
     keyframes, animation, plugins) as a plain data module - `.cjs` so
     Tailwind's config loader never has to transpile workspace TS.
2. **Resolution wiring**: root tsconfig gains `"@csq/ui/*": ["./packages/ui/src/*"]`;
   dashboard and web tsconfigs gain the same mapping (relative form, as
   they did for `@csq/core`); dashboard's `next.config.mjs` adds
   `@csq/ui` to `transpilePackages` (web gets it too, for its eventual
   deploy).
3. **Dashboard swap**: imports `@/components/ui/*` -> `@csq/ui/components/ui/*`,
   `@/lib/utils` -> `@csq/ui/lib/utils`, `@/components/seo` ->
   `@csq/ui/components/seo`; `globals.css` keeps ONLY the app layers
   (components/utilities/scenario css) and imports the shared base;
   `tailwind.config.ts` becomes content globs + `presets:
   [require("@csq/ui/tailwind-preset.cjs")]`; the UI deps leave
   dashboard's package.json.
4. **Web swap**: same import swaps for cn/Seo; tailwind preset adoption;
   and the css cleanup the register flagged - web's `globals.css` is
   replaced by the shared base PLUS ONLY its landing-specific sections,
   deleting the inbox/landing-dead styles it copied but never renders.
   `cn` and `seo.tsx` local copies are deleted.
5. **Dependency hygiene**: `npm install` re-locks; the four UI deps live
   only under `packages/ui`; the encoding guard gains a walk for
   `packages/ui/src`.

## Acceptance

- `npm run build` + `npm run build:api` green; all self-check suites and
  the encoding gate pass.
- Visual spot-check parity: the dashboard inbox (bubbles, dialogs) and
  the web landing render identically to before.
- Web's compiled css no longer contains inbox styles (diff the built css
  classes).
- Boundary greps clean: no app still imports the moved local paths;
  `@csq/ui` imports nothing from any app and nothing from `@csq/core`.
- Register item 7 closes; changelog entry added.

## Risks and mitigations

- **Import-rewrite misses** - caught by the TS build gate; mechanical
  rewrite script + grep verify, same method as the Phase 2 core rewrite.
- **Visual drift from the css split** - the shared base is byte-moved,
  not rewritten; spot-checks catch divergence.
- **Tailwind preset loading** - mitigated up front by shipping the preset
  as `.cjs` data (no workspace-TS-in-config-loader gamble).
- **web is undeployed** - its build gate (`npm run build -w apps/web`)
  is part of the verification; no service changes needed.
