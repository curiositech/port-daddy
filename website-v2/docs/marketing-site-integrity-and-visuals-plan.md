# Marketing Site Integrity + Visuals Plan

## Scope

This slice hardens the marketing site against quiet content drift and prepares
the broader visual refresh the operator requested:

- Fail fast when internal route literals, blog-entry links, or public asset
  literals point at nothing.
- Fail fast when a light-mode public image used by the site does not have a
  resolvable dark-mode sibling.
- Inventory the currently dirty website branch before broad palette or logo
  changes.
- Find the palette-expansion PR, then migrate colors through the token layer
  instead of scattering one-off literals.
- Regenerate missing dark variants with Nano Banana using the light image as
  the only visual reference by default, so dark siblings preserve the original
  scene instead of compositing unrelated style art.

## Current State

- Branch: `codex/homepage-hero-followup`
- Worktree: `/Users/erichowens/.codex/worktrees/95bf/port-daddy`
- The branch is already dirty with homepage hero, blog card, dark-asset, and
  product-logo changes.
- `ThemedImage` and `toDarkSrc` exist; the key gap is keeping all referenced
  assets covered as content changes.
- Existing SEO tests check metadata routes and OG source images, but they do
  not scan arbitrary JSX/Markdown link and image literals across the site.
- Palette source found: PR #455 (`feat/brand: story palette`) adds
  health/sage, indigo, violet, and rust story hues mapped to the ADR-0048
  stack. This branch now carries those semantic tokens alongside the merged
  console `brand-heat` / `brand-warm` roles.
- `GEMINI_API_KEY` is available from the main repo `.env.local`, not this
  linked worktree's local env files.

## Immediate Slice

1. Add a Vitest integration test in `website-v2/src/site-integrity.test.ts`.
2. Parse TS/TSX with `ts-morph`; avoid brittle regex-only checks for JSX.
3. Scan Markdown blog content for local links and images.
4. Compare internal links against:
   - explicit route declarations in `src/main.tsx`
   - `siteMetadataRoutes`
   - live blog slugs and deprecated blog redirects
   - known dynamic route prefixes that validate at runtime
5. Compare public asset literals against `website-v2/public`.
6. Require dark siblings for referenced light image assets, using the same
   resolver semantics as `toDarkSrc`.

Implemented in `src/site-integrity.test.ts`.

## Dark Variant Generation

- `npm run generate:dark-variants -- --list --force` enumerates the light
  assets and exact dark sibling paths that the integrity test expects.
- `npm run generate:dark-variants -- --force --asset /img/generated/foo.webp`
  uses Nano Banana Pro (`gemini-3-pro-image` by default) when
  `GEMINI_API_KEY` is available.
- The generator uses the light asset as the only visual reference unless
  `--style /path/to/style.webp` is explicitly passed. Prompts include the story
  palette from PR #455 and forbid importing a second scene, frame, or props.
- Current dark siblings were filled with local deterministic dark-mode
  fallbacks so the site no longer 404s in dark mode. Replace those with the
  Nano Banana output when credentials are available.
- Replaced the weak PD Tube playground switchboard pair and Harness hero pair
  with Gemini-generated light art plus single-source dark siblings. These are
  the intended pattern for replacing the remaining local fallbacks: create a
  specific light scene when the old art is generic, then derive the dark sibling
  from that exact source.

## Broad Visual Slice

This needs a separate pass after the test gate is stable:

1. Fetch/search PRs and branches for the palette expansion source.
2. Extract source colors into the existing token layer.
3. Update logo gradients and color blocking through semantic roles.
4. Generate only the missing or visibly weak dark variants with Nano Banana Pro.
5. Use the light source image as the default and only reference image; use an
   explicit `--style` reference only for assets where visual inspection proves
   it does not contaminate the scene.
6. Optimize outputs to web-friendly formats and rerun the integrity test.
7. Capture desktop/mobile light and dark screenshots for the changed routes.

## Risks

- This branch has user-owned uncommitted visual work. Do not revert or normalize
  unrelated dirty files.
- Broad palette changes before finding the palette PR would risk drifting from
  the intended brand direction.
- Nano Banana generation needs network and `GEMINI_API_KEY`. The local
  fallbacks are only a bridge; use `generate:dark-variants` to replace them
  with reference-grounded art.

## Gates

- `npm run test -- src/site-integrity.test.ts`
- Focused existing tests around `ThemedImage`, blog data, and SEO metadata
- Touched-file ESLint
- `npm run build`
- Screenshot proof for routes whose visuals change
