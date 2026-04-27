# Port Daddy Website Ideal Web App Rehab Plan

Last updated: 2026-04-27
Owner session: `session-a4b3a18d-1651-4d2b-b4ca-e83fb79b5ea3`
Skill contract: `ideal-web-app-builder` plus `swiss-modern-website-design`
Status: visual decision board approved; stabilization, token/performance, MCP proof-route, Swiss-modern grid-layer, Storybook state-matrix, MCP a11y, and public shell unification slices implemented
SEO metadata/discovery and generated visual replacement slices implemented

This is the on-disk source of truth for rehabilitating `website-v2` into a
premium, stable, token-disciplined web app. Keep this file current before code
fanout. Do not let implementation outrun the visual decision board.

## Scope

- Product: Port Daddy public website and docs shell in `website-v2/`.
- Primary users: senior engineers, agent-tool builders, platform teams, and
  operators evaluating local multi-agent coordination infrastructure.
- Primary jobs: understand the product, install it, trust the protocol, inspect
  docs/API/examples, and decide whether to adopt it.
- Launch standard: production marketing/docs site with reliable build, passing
  lint/test/storybook gates, accessible mobile/desktop surfaces, route-specific
  SEO, installable PWA posture if approved, truthful claims, and observable
  release evidence.
- Non-goals for the first execution slice: rebrand away from Port Daddy, delete
  the broad route surface, replace the control plane, or rewrite all content
  before the design direction is approved.
- Known constraints: Vite/React 19/Tailwind 4 app, Radix already present,
  generated Storybook output is ignored residue, and older public-site reset
  notes in `docs/recovery/CURRENT-WORK.md` must not be treated as authority
  over this rehab without explicit approval.
- Existing repo mode: dirty-repo rehabilitation, even though the git worktree
  is clean, because the site has known architectural, design, and test drift.
- Dirty files to preserve: current tree includes unrelated actor, semantic,
  CLI, skill, and recovery-ledger work outside this website slice. Stage
  website rehab files explicitly and do not bundle those other slices.
- Ignored local residue under `website-v2/` includes `dist/`,
  `storybook-static/`, logs, `.DS_Store`, and local helper scripts.

## Current-State Intake

- Branch: `main`, in sync with `origin/main` after pushing `5d29704`.
- Recent commits:
  - `5d29704 Stabilize website rehab baseline`
  - `3ef7224 Upgrade skill architecture doctrine`
  - `66996a1 Harden promotion test diagnostics`
  - `b074370 Add V4 Bosun heartbeat supervisor`
- Package manager: npm with `website-v2/package-lock.json`.
- Framework: Vite 7, React 19, Tailwind 4, React Router 7, Storybook 10.
- Primitive libraries: Radix packages are installed, but the active public
  component layer still mixes custom markup, primitive wrappers, and ad hoc page
  composition.
- Build command: `npm run build` from `website-v2/`.
- Test command: `npm run test` from `website-v2/`.
- Storybook command: `npm run build-storybook` from `website-v2/`.
- Lint command: `npm run lint` from `website-v2/`.
- Dev server: Port Daddy assigned port `3105`; Vite was run with
  `npm run dev -- --host 127.0.0.1 --port 3105 --strictPort`.

### Baseline Gates

| Gate | Result | Evidence |
|---|---|---|
| Build | Pass | 2026-04-27 latest: `npm run build` passes after generated visual replacement. Largest generated JS chunk remains `Mermaid-JRtoNcsk.js` at 491.00 kB minified / 136.63 kB gzip. |
| Tests | Pass | 2026-04-27 latest: full `npm run test` passes at 8/8 files and 83/83 tests, including design-system contract coverage plus route metadata, sitemap/robots/LLM discovery, generated social-image manifest coverage, and SPA document-head behavior. |
| Lint | Pass | 2026-04-27: `npm run lint` passes after the generated visual replacement slice. |
| Storybook build | Pass with warning | 2026-04-26: `npm run build-storybook` passes with the a11y addon configured through `wcag2aaa` plus `color-contrast-enhanced`. Preview iframe remains large at 1,087.59 kB / 307.00 kB gzip and Storybook reports missing package metadata for `radix-ui`. |
| MCP a11y | Pass for proof route | 2026-04-26: `npm run test:a11y:mcp` passes against `/mcp` at desktop 1440x1200 and mobile 390x1200 with 0 axe violations, keyboard roving-tab checks, visible focus outline, and no horizontal overflow. Report: `docs/reports/website-rehab-a11y/mcp-a11y-report.json`. |
| Public shell a11y | Pass for route matrix | 2026-04-26: `npm run test:a11y:shell` passes for `/`, `/docs`, `/mcp`, and `/blog` at desktop 1440x1200 and mobile 390x1200 with 0 axe violations, one shared shell header/footer/main, a visible skip link, and no horizontal overflow. Report: `docs/reports/website-rehab-a11y/public-shell-a11y-report.json`. |
| Screenshot baseline | Captured | `docs/reports/website-rehab-screenshots/`. |

## Screenshot Baseline

- Home desktop: `docs/reports/website-rehab-screenshots/home-desktop.png`
- Home mobile: `docs/reports/website-rehab-screenshots/home-mobile.png`
- Docs desktop: `docs/reports/website-rehab-screenshots/docs-desktop.png`
- Docs mobile: `docs/reports/website-rehab-screenshots/docs-mobile.png`
- MCP desktop: `docs/reports/website-rehab-screenshots/mcp-desktop.png`
- MCP mobile: `docs/reports/website-rehab-screenshots/mcp-mobile.png`
- MCP proof desktop: `docs/reports/website-rehab-screenshots/mcp-proof-desktop.png`
- MCP proof mobile: `docs/reports/website-rehab-screenshots/mcp-proof-mobile.png`
- MCP Swiss desktop: `docs/reports/website-rehab-screenshots/mcp-swiss-desktop.png`
- MCP Swiss mobile: `docs/reports/website-rehab-screenshots/mcp-swiss-mobile.png`
- MCP a11y desktop: `docs/reports/website-rehab-screenshots/mcp-a11y-desktop.png`
- MCP a11y mobile: `docs/reports/website-rehab-screenshots/mcp-a11y-mobile.png`
- Blog desktop: `docs/reports/website-rehab-screenshots/blog-desktop.png`
- Blog mobile: `docs/reports/website-rehab-screenshots/blog-mobile.png`
- Public shell route matrix:
  - Home: `docs/reports/website-rehab-screenshots/shell-home-desktop.png`,
    `docs/reports/website-rehab-screenshots/shell-home-mobile.png`
  - Docs: `docs/reports/website-rehab-screenshots/shell-docs-desktop.png`,
    `docs/reports/website-rehab-screenshots/shell-docs-mobile.png`
  - MCP: `docs/reports/website-rehab-screenshots/shell-mcp-desktop.png`,
    `docs/reports/website-rehab-screenshots/shell-mcp-mobile.png`
  - Blog: `docs/reports/website-rehab-screenshots/shell-blog-desktop.png`,
    `docs/reports/website-rehab-screenshots/shell-blog-mobile.png`
- Generated visual replacement proof:
  `docs/reports/website-rehab-screenshots/generated-hero-homepage.png`

Visible diagnosis from the baseline:

- Home desktop has a strong first-viewport product signal but too much dead
  vertical air, a washed-out hero image, and low-energy secondary copy.
- Home mobile stacks cleanly, but the first viewport still leans on very heavy
  type, the image disappears below the fold, and the secondary CTA is visually
  weak.
- Docs desktop has a coherent paper/ink/lime shell, but the shell is visually
  disconnected from the marketing home nav and is heavy enough to feel like a
  different product.
- MCP mobile has severe contrast failure: hero paragraph text is nearly
  invisible on the light background and the headline overlap/weight reads
  unstable.
- MCP proof and a11y screenshots now show the rebuilt route on shared
  primitives: desktop uses the intended proof/grid layout, mobile wraps without
  page-level horizontal clipping, and the MCP route has axe/keyboard/focus
  evidence for the proof slice.
- Blog and MCP carry many hardcoded style decisions and should be normalized
  after the system contract is approved.
- The public shell route matrix now proves the shared header/footer/main
  wrapper across home, docs, MCP, and blog at desktop and mobile sizes. The
  next visible drift is page-internal typography/card cleanup, not shell
  reachability or horizontal clipping.

## Visual Decision Review

- Review artifact: `docs/plans/port-daddy-website-visual-decision-board.md`
- Static review artifact: `docs/reports/port-daddy-website-visual-decision-board.html`
- Approval status: approved for the first stabilization slice.
- Approval date: 2026-04-26.
- Rule: broad token, route, content, observability, PWA, legal, and visual
  rewrites still need slice-level evidence and plan updates before fanout.

## Research Baseline

Current references checked on 2026-04-24:

- TypeUI lists design-skill families such as Paper, Bento, Neobrutalism, Clean,
  Refined, Perspective, Premium, and others. Use these as inspiration, not as
  a blind download. Source: https://www.typeui.sh/design-systems
- Tailwind 4 theme variables are the correct substrate for utility APIs, while
  regular `:root` variables are still useful for non-utility runtime tokens.
  Source: https://tailwindcss.com/docs/customizing-spacing/
- Radix Primitives are appropriate for accessible unstyled design-system
  behavior, including focus management and keyboard navigation. Source:
  https://www.radix-ui.com/primitives/docs/overview/accessibility
- Storybook's a11y addon can run axe-backed checks as a first-line component
  accessibility gate. Source:
  https://storybook.js.org/docs/writing-tests/accessibility-testing
- WCAG 2.2 adds focus-not-obscured, focus appearance, target size, dragging
  alternatives, redundant entry, and accessible-authentication criteria.
  Source: https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- Core Web Vitals remain LCP, INP, and CLS; field measurement and chunking work
  should target these rather than only lab build output. Source:
  https://web.dev/patterns/web-vitals-patterns
- PWA installability requires a manifest with app name/icon/start/display
  members and HTTPS or localhost/loopback. Source:
  https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
- Sentry browser telemetry needs an explicit privacy posture because SDK data
  can include URLs/query strings by default, while cookies/user/IP are not sent
  unless configured. Source:
  https://docs.sentry.io/platforms/javascript/guides/react/data-management/data-collected

## Proposed Design Direction

Recommended direction: **signal-grade infrastructure editorial**.

This keeps the current paper/ink/blue/lime distinctiveness but makes it more
professional, less shouty, and more stable:

- TypeUI inspiration: `Refined` for typography discipline, `Paper` for docs
  tactility, `Perspective` for technical diagrams, and a very limited
  `Neobrutalism` inheritance only where it supports protocol seriousness.
- Swiss-modern overlay: use International Typographic Style as the structural
  discipline behind the signal-grade identity: 12-column composition, visible
  alignment, typographic hierarchy, disciplined asymmetry, flatter surfaces,
  and scarce accent use. This is not a grayscale redesign.
- Brand posture: trustworthy local infrastructure, not mascot comedy and not
  a generic SaaS gradient.
- Typography: replace global `font-black` defaults with role-specific weights;
  add a real display/body/mono contract with optical sizing and high-DPI
  screenshot verification. Evaluate a paid or licensed display face only after
  the user approves the visual board.
- Color: keep source literals only in token-source files; generate semantic
  aliases and component roles from a documented palette. The MCP mobile
  contrast failure is a launch blocker.
- Shape: decide between square protocol panels and a small curved radius
  system. The current mix of `rounded-[100px]`, `rounded-[60px]`, zero radii,
  and round pills is not coherent.
- Motion: keep Framer Motion only for causality/orientation; remove animated
  randomness from render paths and respect reduced motion.

## Design-System Contract Target

Create or normalize these layers before page fanout:

1. Source tokens:
   - file target: `website-v2/src/styles/tokens.source.css`
   - contains measured color literals, type families, scale constants, and
     provenance comments
2. Semantic aliases:
   - file target: `website-v2/src/styles/tokens.semantic.css`
   - contains `--surface-*`, `--text-*`, `--action-*`, `--status-*`,
     `--focus-*`, `--content-*`, light/dark/high-contrast variants
3. Component/application roles:
   - file target: `website-v2/src/styles/tokens.roles.css`
   - contains `--button-*`, `--badge-*`, `--panel-*`, `--docs-rail-*`,
     `--hero-*`, `--code-*`, `--grid-*`, `--measure-*`, `--chart-*`,
     `--og-*`

Production React components should consume only role tokens or approved
semantic utilities. Raw visual values are allowed only in source token files,
generated assets, and quarantined legacy files explicitly listed in the drift
map.

## Component Inventory Priorities

| Component/surface | Primitive base | States required | Storybook status | Rehab decision |
|---|---|---|---|---|
| `Button` | native button/link + Radix where needed | default, hover, focus, active, disabled, loading, icon-only, dark, mobile | partial | normalize |
| `Badge` | span/link role wrapper | all tones, dense, dark, high-contrast | partial | normalize |
| `Surface` / panels | base primitive | depths, interactive, overflow, responsive | partial | normalize |
| `SiteHeader` / nav | Radix NavigationMenu where appropriate | desktop, mobile, keyboard, active route, dark | partial | replace/normalize |
| `DocsLayout` / sidebar | Radix ScrollArea/Tabs where useful | active route, overflow, focus, mobile | partial | normalize |
| `CodeBlock` | semantic pre/code + copy button | wrap, scroll, copy states, dark, reduced motion | partial | normalize |
| `Blog cards` | Surface composites | image loaded/error, tags, long title, mobile | weak | normalize |
| `MCP runtime tabs/cards` | Radix Tabs/Button primitives | active/inactive, keyboard, contrast, mobile | weak | replace first |
| `Landing hero` | page assembly | desktop/mobile, image loading, CTA states | weak | normalize |

## App Surfaces

| Route/page | Purpose | Current status | Decision |
|---|---|---|---|
| `/` | product landing | visually strong but airy; image/copy/contrast need polish | normalize |
| `/docs` and `/docs/**` | developer docs | coherent shell; route/data model broad; nav differs from marketing | normalize |
| `/mcp` | integration pitch | high visual drift and mobile contrast failure | replace first |
| `/blog`, `/blog/:slug` | SEO/editorial | content exists; metadata and component states incomplete | normalize |
| `/tutorials/**` | learning path | tests prove order/nav drift | stabilize first |
| `/integrations/**`, `/templates/**`, `/cookbook/**` | product ecosystem | hardcoded radius/type/color drift | normalize after primitives |
| `/dashboard` | live control-plane demo | depends on daemon routes; runtime truth must be verified | audit before visual rewrite |

## Rehabilitation Map

| Surface | Current issue | Decision | Migration path | Status |
|---|---|---|---|---|
| Tutorial system | failing tests around totals, numbering, prev/next, orphan route | preserve behavior, fix truth | repair canonical `tutorials.ts` and page props before visual fanout | completed for first slice |
| ESLint config | lints ignored Storybook output; many real source issues mixed with generated noise | normalize | exclude generated dirs first, then fix real source categories | completed for current lint gate |
| Token files | source, semantic, and role tokens were interleaved | normalize | split token layers, keep compatibility aliases, add drift tests | completed for entrypoint and protected-module contract |
| Route bundling | all route/page modules were statically imported into the app entry | normalize | lazy-load route modules and isolate heavy vendor families | completed for public routes |
| MCP page | hardcoded provider colors, inline styles, mobile AAA failure | replace | rebuild on approved primitives and token roles | completed for first proof route |
| Storybook | exists but state coverage is shallow | normalize | add component matrices and a11y addon after primitives stabilize | in progress; public primitive, base UI, and MCP route gates are wired |
| Public shell | landing and docs used different shell/nav systems | normalize | route all public pages through `MainLayout`, shared `SiteHeader`, and shared footer re-export | completed for home/docs/MCP/blog matrix |
| SEO/meta | app-wide defaults plus limited title/description hook; no per-route OG images | replace | route metadata registry, generated social images, sitemap/robots | completed for canonical routes and discovery artifacts |
| PWA/favicons | minimal assets; no manifest discovered | add if approved | app.webmanifest, icon set, offline strategy decision | pending |
| Observability | no Sentry/browser telemetry setup found | add if approved | privacy-first Sentry wrapper, release tags, scrub rules, dashboards | pending |
| Legal/privacy | no complete terms/privacy route found | add | product-specific terms/privacy/support/security-contact pages | pending |

### 2026-04-26 Stabilization Slice

Implemented after the visual decision board was approved:

- Preserved the broad tutorial route surface and promoted
  `/tutorials/semantic-identities` into the canonical tutorial sequence.
- Repaired tutorial numbering, totals, and previous/next links across all 20
  tutorial pages.
- Replaced the duplicated hardcoded tutorial-progress list with canonical data
  from `src/data/tutorials.ts`.
- Split `useTutorialProgress` out of the component module and made local
  storage initialization lazy, avoiding fast-refresh and React Compiler debt.
- Excluded generated `storybook-static` output from ESLint.
- Removed deterministic-source lint blockers: render-time `Math.random()` in
  `HarborViz`, stale Mermaid `no-unsanitized/property` suppression, `any`
  types in dashboard/viz/page surfaces, no-useless markdown escapes, and
  fast-refresh non-component exports.
- Split theme/docs-search/signal-flag helper exports out of component modules.
- Converted typewriter/loading/tutorial-return states away from synchronous
  state resets in effects.

Validation on 2026-04-26:

- `npm run lint` from `website-v2/`: pass.
- `npm run test -- src/data/tutorials.test.ts` from `website-v2/`: 35/35 pass.
- `npm run test` from `website-v2/`: 69/69 pass.
- `npm run build` from `website-v2/`: pass with the known large-main-chunk
  warning.
- `npm run build-storybook` from `website-v2/`: pass with the known large
  iframe chunk warning and `radix-ui` package metadata warning.

### 2026-04-26 Token and Performance Slice

Implemented after the first stabilization commit:

- Split the active token entrypoint into explicit source, semantic, and
  role layers:
  - `website-v2/src/styles/tokens.source.css`
  - `website-v2/src/styles/tokens.semantic.css`
  - `website-v2/src/styles/tokens.roles.css`
  - `website-v2/src/styles/tokens.css`
- Preserved compatibility aliases so legacy pages can migrate in bounded
  route slices instead of breaking all at once.
- Added contract tests for token import order, protected-module raw color
  literals, and the router lazy-loading contract.
- Replaced the static route import fanout in `website-v2/src/main.tsx` with
  `React.lazy` and `Suspense`.
- Added `RouteFallback` as a reusable layout primitive with `role="status"`.
- Added conservative Vite manual chunking for React, Motion, Markdown, Mermaid,
  Three, and react-force-graph families without flattening everything into one
  oversized vendor chunk.

Validation on 2026-04-26 from `website-v2/`:

- `npm run lint`: pass.
- `npm run test -- src/design-system-contracts.test.ts`: 9/9 pass.
- `npm run test`: 72/72 pass.
- `npm run build`: pass with no chunk-size warning. Largest JS chunk is now
  `Mermaid-CMXUcArO.js` at 491.12 kB minified / 136.65 kB gzip; the app route
  shell chunk is `App-Bp-5vPKf.js` at 20.43 kB minified / 6.80 kB gzip.

Remaining launch blockers:

- Mermaid remains just under the default 500 kB warning threshold. The next
  performance pass should defer Mermaid rendering more aggressively or replace
  some route diagrams with pre-rendered/static assets where interaction is not
  needed.
- Raw color literals and hardcoded visual values still exist in unprotected
  legacy page modules outside the now-rebuilt MCP proof route.
- MCP visual contrast/overflow has proof screenshots now, but axe, keyboard,
  and screen-reader checks are still pending.
- Storybook state matrices, a11y addon evidence, SEO/OG/PWA/legal/privacy, and
  observability are still unimplemented product-readiness work.

### 2026-04-26 MCP Proof Route Slice

Implemented after the token/performance slice:

- Rebuilt `/mcp` on the approved public-site primitives:
  `PageContainer`, `SectionIntro`, `SurfacePanel`, `PanelTitle`, `PanelBody`,
  `BracketLabel`, `BracketLink`, and `DocsCodeBlock`.
- Removed the previous ad hoc provider-color surface from the MCP route. The
  page now consumes tokenized role/semantic colors and shared code panels.
- Added an accessible tab pattern for the CLI/MCP/SDK/REST pub/sub surface with
  `tablist`, `tab`, and `tabpanel` semantics.
- Rewrote the route copy around supportable Port Daddy primitives: sessions,
  ports, locks, pub/sub, salvage, fleets, tuple space, budgets, and daemon
  authority.
- Fixed invalid Tailwind arbitrary grid tracks that used comma-separated
  values. The rebuilt page now uses space-separated `minmax(0, ...)` tracks so
  desktop grids actually render.
- Hardened shared public primitives and code blocks with `min-w-0`/`max-w-full`
  behavior so wide code samples scroll inside their blocks instead of widening
  the page on mobile.
- Added design-system contract coverage that the MCP route uses shared
  primitives, avoids raw color literals and visual inline styles, avoids the old
  invalid grid-track literals, and that the shared page container is shrink-safe.
- Captured proof screenshots:
  - `docs/reports/website-rehab-screenshots/mcp-proof-desktop.png`
  - `docs/reports/website-rehab-screenshots/mcp-proof-mobile.png`

Validation on 2026-04-26 from `website-v2/`:

- `npm run lint`: pass.
- `npm run test -- src/design-system-contracts.test.ts`: 10/10 pass.
- `npm run test`: 73/73 pass.
- `npm run build`: pass with no chunk-size warning. Largest JS chunk is
  `Mermaid-NIUzfny0.js` at 491.12 kB minified / 136.66 kB gzip; the MCP route
  chunk is `MCPPage-Cs0vR24E.js` at 18.62 kB minified / 6.08 kB gzip.
- Playwright screenshots at 1440x1200 and 390x1200: pass by manual inspection
  for settled-route capture, desktop grid layout, mobile wrapping, and no
  page-level horizontal clipping.

Remaining launch blockers after this slice:

- Storybook coverage for the MCP route's underlying states is not complete.
- Axe/keyboard/manual screen-reader checks have not run for the rebuilt route.
- SEO/OG/PWA/legal/privacy/observability remain future product-readiness work.
- Mermaid remains near the default chunk warning threshold.

### 2026-04-26 Swiss-Modern Grid Layer Slice

Implemented after looking up and applying the local `swiss-modern-website-design`
skill:

- Ran the Swiss-modern frontend audit against `website-v2`. It reported the
  expected drift: 219 literal color instances, 145 unique literal colors, 203
  radius patterns, 121 shadow patterns, and 185 width patterns. This confirms
  the remaining problem is broader than the MCP proof route.
- Added source and role tokens for a stricter Swiss-modern layout layer:
  `--layout-grid-columns`, `--layout-grid-gap`, `--layout-copy-measure`,
  `--layout-caption-measure`, `--layout-meta-measure`, `--grid-*`, and
  `--measure-*`.
- Flattened the shared public elevation tokens from the earlier bolder
  neobrutalist offsets toward a calmer editorial surface:
  `--shadow-raised`, `--shadow-sm`, and `--shadow-pressed`.
- Added shared `SwissGrid` and `SwissGridItem` primitives using a 12-column
  desktop grid and single-column mobile collapse.
- Updated the public primitive Storybook story to show the Swiss grid primitive
  as the layout contract instead of another local grid.
- Reworked the MCP proof route onto the Swiss grid:
  - 7/5 hero composition for the page argument plus install proof panel
  - 3/9 rail/body sections for tools and pub/sub
  - 7/5 and 6/6 editorial proof sections for fleet and tuple space
  - mobile remains single-column and shrink-safe
- Captured proof screenshots:
  - `docs/reports/website-rehab-screenshots/mcp-swiss-desktop.png`
  - `docs/reports/website-rehab-screenshots/mcp-swiss-mobile.png`

Validation on 2026-04-26 from `website-v2/`:

- `npm run lint`: pass.
- `npm run test -- src/design-system-contracts.test.ts`: 10/10 pass.
- `npm run test`: 73/73 pass.
- `npm run build`: pass with no chunk-size warning. Largest JS chunk is
  `Mermaid-C7kUbfif.js` at 491.12 kB minified / 136.65 kB gzip; the MCP route
  chunk is `MCPPage-BRPJpuq-.js` at 18.66 kB minified / 6.12 kB gzip.
- `npm run build-storybook`: pass with the known large iframe chunk warning and
  `radix-ui` package metadata warning.
- Playwright screenshots at 1440x1200 and 390x1200: pass by manual inspection
  for clearer desktop grid alignment, calmer surface depth, mobile wrapping,
  and no page-level horizontal clipping.

Remaining launch blockers after this slice:

- The Swiss grid now exists as a primitive, but most legacy routes still use
  arbitrary max-widths, radii, shadows, and page-local grids.
- Accent discipline is improved only on the proof route; color-literal cleanup
  remains broader product debt.
- Storybook still needs state matrices and a11y-addon evidence, not just a
  primitive example.

### 2026-04-26 Storybook State Matrix and MCP A11y Slice

Implemented after the Swiss-modern grid layer:

- Added and enforced public primitive state-matrix coverage for shared layout,
  panel tone, code, link, empty, and error states in Storybook.
- Kept base UI state matrices for Button, Badge, Surface, and CodeBlock wired
  into the design-system contract test so Storybook state coverage is a release
  gate instead of a nice-to-have artifact.
- Configured Storybook a11y to run axe through `wcag2aaa` plus
  `color-contrast-enhanced`, matching the strict MCP route script instead of
  stopping at AA labels.
- Hardened the MCP pub/sub tabs with explicit vertical tablist orientation,
  roving tab index, arrow-key navigation, Home/End navigation, visible focus,
  and a contract test that prevents silent regression.
- Re-ran the MCP Playwright/axe route gate and refreshed the a11y report:
  `docs/reports/website-rehab-a11y/mcp-a11y-report.json`.

Validation on 2026-04-26 from `website-v2/`:

- `npm run lint`: pass.
- `npm run test -- src/design-system-contracts.test.ts`: 11/11 pass.
- `npm run test`: 7/7 files and 74/74 tests pass.
- `npm run test:a11y:mcp`: pass with 0 desktop axe violations, 0 mobile axe
  violations, 4 roving tabs, visible focus outline, and no horizontal overflow.
- `npm run build`: pass with no chunk-size warning. Largest JS chunk is
  `Mermaid-CMec62CS.js` at 491.12 kB minified / 136.65 kB gzip; the MCP route
  chunk is `MCPPage-Cqgjlo-C.js` at 19.34 kB minified / 6.39 kB gzip.
- `npm run build-storybook`: pass with the known large iframe chunk warning
  and `radix-ui` package metadata warning. The built preview iframe is
  1,087.59 kB minified / 307.00 kB gzip.

Remaining launch blockers after this slice:

- Storybook coverage is materially better, but still not complete across every
  route composite, loading/error branch, and data-dense dashboard surface.
- MCP proof-route a11y is evidenced. The public shell route matrix now has axe,
  skip-link, structure, and overflow coverage, but reduced-motion and manual
  screen-reader passes still remain.
- SEO/OG/PWA/legal/privacy/observability and the claims ledger remain future
  product-readiness work.

### 2026-04-27 Generated Visual Replacement Slice

Implemented after the user rejected the sailor/rounded visual direction and
provided a Gemini API key:

- Added `website-v2/scripts/generate-gemini-assets.mjs` plus
  `npm run generate:visuals` and `npm run optimize:visuals`.
- The generator reads `GEMINI_API_KEY` from the shell, repo-root `.env.local`,
  or `website-v2/.env.local`; the key is never written to source or the
  generated manifest.
- Generated four Nano Banana / Gemini assets under
  `website-v2/public/img/generated/`:
  - `control-plane-hero.jpg` / `control-plane-hero.webp`
  - `control-plane-og.jpg` / `control-plane-og.webp`
  - `agent-runtime-map.jpg` / `agent-runtime-map.webp`
  - `salvage-ledger.jpg` / `salvage-ledger.webp`
- Added `website-v2/public/img/generated/manifest.json` with model, prompt,
  optimization, and provenance metadata.
- Optimized generated JPEGs through ImageMagick at quality 82 and generated
  WebP variants through `cwebp` at quality 82. The visible home hero uses WebP
  with a JPEG fallback; the default OG image remains JPEG for crawler/social
  compatibility.
- Replaced the homepage sailor hero with the generated control-plane schematic,
  moved the responsive hero breakpoint to `min-[900px]` so the visual appears
  in the in-app browser first viewport, and removed the unused
  `website-v2/public/img/hero-portdaddy.png` asset.
- Updated default social metadata and blog fallback imagery to use generated
  assets rather than the retired sailor image or missing blog files.
- Removed the most visible legacy wording and shape drift in the touched public
  surfaces: hero pills, CTA banner copy/icon/radii, badge default shape, and
  stale "neumorphic" comments in touched source/story files.
- Added a regression test that the default social image is generated and the
  retired sailor hero does not exist.
- Browser proof:
  `docs/reports/website-rehab-screenshots/generated-hero-homepage.png`.

Validation on 2026-04-27 from `website-v2/`:

- `npm run generate:visuals`: generated 4 assets with
  `gemini-3.1-flash-image-preview`.
- `npm run optimize:visuals`: optimized 4 generated assets.
- `npm run generate:seo`: generated SEO artifacts for 182 canonical routes.
- `npm run lint`: pass.
- `npm run test`: 8/8 files and 83/83 tests pass.
- `npm run build`: pass; largest generated JS chunk remains Mermaid at
  491.00 kB minified / 136.63 kB gzip.
- `npm run build-storybook`: pass with the known Storybook iframe size warning
  and `radix-ui` package metadata warning.
- root `npm test -- --no-coverage`: 153/153 suites passed, 5082/5083 tests
  passed, 1 intentional skip; existing console noise included git-probe,
  telemetry-bypass, keychain/plaintext fallback, and subscriber-error test
  logs.
- Browser verification: in-app browser loaded `http://127.0.0.1:3111/` and
  showed the generated schematic in the first viewport.

### 2026-04-27 Visual Metaphor Cleanup Slice

Implemented after the generated-asset replacement commit to keep removing the
old rounded/nautical visual system from production code:

- Renamed the terminal wrapper from `NeumorphicTerminal` to
  `CommandTerminal` and updated landing demos, docs primitives, examples, blog
  posts, and public-shell contract tests.
- Replaced the dashboard `SailorAgent` SVG with `AgentNodeMark`, a rectilinear
  infrastructure glyph that keeps the live graph readable without mascot or
  nautical imagery.
- Replaced the live graph's central anchor icon with a network icon and reduced
  agent node/status radii to design-system token radii.
- Tightened homepage feature-card radius from `2xl` to `lg` so the public
  landing surface keeps moving toward the Swiss-modern, low-rounding contract.
- Production source no longer references `NeumorphicTerminal` or
  `SailorAgent`; the remaining sailor wording in source is the explicit
  retired-hero regression test.

Validation on 2026-04-27 from `website-v2/`:

- `npm run lint`: pass.
- `npm run test`: 8/8 files and 83/83 tests pass.
- `npm run build`: pass; largest generated JS chunk remains Mermaid at
  491.00 kB minified / 136.63 kB gzip.
- `npm run build-storybook`: pass with the known Storybook iframe size warning
  and `radix-ui` package metadata warning.

Remaining launch blockers after this slice:

- Other route composites still carry large rounded panels, decorative blurred
  circular glows, and legacy elevation density. Continue route-by-route rather
  than sweeping every surface at once.
- Public docs/tutorial content still uses the product term "harbor" where it
  names real Port Daddy capability primitives. That is product vocabulary, not
  the rejected sailor-photo visual direction.
- PWA/favicons, legal/privacy/support/security-contact, observability,
  Lighthouse/Web Vitals, reduced-motion, forced-colors, and manual
  screen-reader evidence remain open.

### 2026-04-27 SEO Metadata and Discovery Slice

Implemented after the shared public shell slice:

- Added `website-v2/src/data/siteMetadata.ts` as the canonical route metadata
  registry for 182 indexable public URLs, drawing from existing source data for
  tutorials, docs families, cookbook recipes, integrations, templates, and
  blog posts.
- Added route-specific document metadata through `DocumentMeta` and
  `useDocumentMeta`, including title, description, canonical URL, robots,
  Open Graph, Twitter card, article fields, tag metadata, and JSON-LD.
- Added `scripts/generate-seo-artifacts.mjs` plus `npm run generate:seo`.
  `npm run build` now runs `prebuild` to regenerate SEO artifacts before Vite
  emits the production bundle.
- Generated `website-v2/public/sitemap.xml` from indexable canonical routes.
  The sitemap intentionally avoids `changefreq` and `priority`, matching
  current Google guidance that those fields are ignored.
- Generated `website-v2/public/robots.txt` with a single sitemap declaration.
- Regenerated `website-v2/public/llms.txt` from the same metadata registry so
  LLM discovery does not drift from public routes.
- Marked canonical-alias pages such as `/docs/api/endpoints` as `noindex` when
  they resolve to another canonical route.
- Added `src/seo-metadata.test.tsx` to guard unique canonicals, existing social
  image files, blog article metadata, sitemap/robots output, LLM discovery, and
  SPA head mutation.

Validation on 2026-04-27 from `website-v2/`:

- `npm run generate:seo`: generated SEO artifacts for 182 canonical routes.
- `npm run test -- src/seo-metadata.test.tsx`: 6/6 pass.
- `npm run lint`: pass.
- `npm run test`: 8/8 files and 82/82 tests pass.
- `npm run build`: pass; `prebuild` regenerates SEO artifacts. Largest JS
  chunk remains Mermaid at 491.00 kB minified / 136.64 kB gzip.

Remaining launch blockers after this slice:

- The SPA now updates route metadata at runtime, but a future prerender/static
  export pass would make non-home route metadata available before JavaScript
  executes.
- Per-route OG image strategy is wired but not complete: pages without a
  verified dedicated image intentionally fall back to the canonical hero image.
- PWA/favicons, legal/privacy/support/security-contact, observability, claims
  ledger, Lighthouse/Web Vitals, reduced-motion, forced-colors, and manual
  screen-reader evidence remain open.
- Mermaid and Storybook/axe payloads need a deeper route-level payload strategy.

### 2026-04-26 Public Shell Unification Slice

Implemented as the next bounded website slice:

- Routed the landing app through `MainLayout` and the shared `SiteHeader`
  instead of the legacy `components/landing/Nav` shell.
- Replaced the old layout footer module with a re-export of `SiteFooter`, so
  legacy routes and new public primitives now converge on the same footer
  surface.
- Added an always-present skip link, shell identity marker
  `header[data-shell="site-header"]`, shared container sizing, desktop docs
  search, mobile search trigger, active-route nav states, and focus-visible
  treatment to `SiteHeader`.
- Removed redundant route-level top padding from public routes that now sit
  under the normal document-flow shell.
- Added `SiteHeader` Storybook shell-frame and state-matrix stories that render
  the header with the shared footer and tokenized page background.
- Added `scripts/check-public-shell-a11y.mjs` and `npm run test:a11y:shell`.
  The script audits `/`, `/docs`, `/mcp`, and `/blog` at desktop 1440x1200 and
  mobile 390x1200, checks shell structure, first-tab skip-link focus,
  horizontal overflow, screenshots, WCAG tags through AAA, and
  `color-contrast-enhanced`.
- Fixed route-matrix failures found by that script:
  - `TerminalDemos` tab rail and terminal column now use shrink-safe
    `minmax(0, 1fr)` layout instead of widening mobile pages.
  - Code identity highlighting now uses code-specific channel tokens instead
    of the brand blue on a dark terminal background.
  - Badge variants now use high-contrast on-tint tokens.
  - Accent foreground tokens were darkened for AAA contrast on lime surfaces.
  - Dimmed `DocsCard` eyebrow opacity was removed.
  - The blog page no longer uses raw color literals for feature badges.

Validation on 2026-04-26 from `website-v2/`:

- `npm run lint`: pass.
- `npm run test -- src/design-system-contracts.test.ts`: 13/13 pass.
- `npm run test`: 7/7 files and 76/76 tests pass.
- `npm run test:a11y:shell`: pass with 0 axe violations across home/docs/MCP/
  blog desktop and mobile, one shared shell header/footer/main per route, a
  visible skip link, and no horizontal overflow.
- `npm run test:a11y:mcp`: pass with 0 desktop and 0 mobile axe violations,
  roving tab keyboard coverage, visible focus, and no horizontal overflow.
- `npm run build`: pass with no chunk-size warning. Largest JS chunk remains
  `Mermaid-BeyLxPjd.js` at 491.00 kB minified / 136.63 kB gzip.
- `npm run build-storybook`: pass with the known large iframe chunk warning and
  `radix-ui` package metadata warning.

Remaining launch blockers after this slice:

- The shell is unified, but many route-internal composites still use legacy
  typography, arbitrary radii, inline style objects, and page-local layout
  decisions.
- Shell a11y is evidenced across the primary public route matrix, but manual
  screen-reader, reduced-motion, forced-colors, Lighthouse, and Web Vitals
  passes still need to run.
- SEO/OG/PWA/legal/privacy/observability and the claims ledger remain future
  product-readiness work.

## Sessions and Ownership

| Session | Owner | Scope | Files | Status | Notes |
|---|---|---|---|---|---|
| `session-80296aef-bf46-4457-b900-b7c9ca9c92fe` | Codex | intake, plan, screenshots, decision board | docs plan files, `website-v2` | completed | static board created and reviewed |
| `session-1a8459c2-808f-4564-ab9d-c5be56fa86bb` | Codex | tutorial/lint/build stabilization | tutorial/data/lint/viz/docs helper files | completed | committed as `5d29704` |
| `session-c2085e79-36d0-4898-9cc5-90c4f60aef3a` | Codex | token contract and route chunking | token files, router entry, Vite config, contract tests | completed | lint/test/build green on 2026-04-26 |
| `session-4174ea2d-db24-4af2-a2d4-d9be7421a26c` | Codex | rebuild MCP proof route | `MCPPage`, shared site/code primitives, contract tests, screenshots | completed | desktop/mobile proof screenshots captured on 2026-04-26 |
| `session-d43caa83-9525-4a04-a1b4-57df1ef92916` | Codex | Swiss-modern grid layer | token files, shared primitives/stories, MCP route, screenshots | completed | Swiss skill audit run; lint/test/build/storybook green on 2026-04-26 |
| `session-38334c91-8bed-45d4-85be-da069cd41648` | Codex | Storybook state matrix and MCP a11y hardening | Storybook preview, MCP route tabs, a11y script/report, contract tests | completed | lint/test/a11y/build/storybook green on 2026-04-26 |
| `session-7d6f4ac6-5c47-401d-853b-804be7eecbd6` | Codex | SEO metadata and discovery | metadata registry, document head hook, sitemap, robots, llms, tests | completed | generate:seo/test/lint/build green on 2026-04-27 |
| future 2 | worker swarm | remaining primitives and route-composite Storybook matrices | components/styles/stories | open | after MCP proof route identifies primitive gaps |
| future 3 | worker swarm | route/page normalization | page dirs by route | blocked | disjoint write sets |
| future 4 | reviewers | a11y/perf/security/privacy/product truth | read-mostly | blocked | adversarial gates |

## Cheap Subagent Execution Plan

Use only after the user approves the visual decision board.

| Agent | Cost tier | Write set | Task | Gates | Status |
|---|---|---|---|---|---|
| Tutorial repair worker | low/mid | `website-v2/src/pages/tutorials`, `website-v2/src/data/tutorials.ts`, tests | repair tutorial order/nav truth | `npm run test -- src/data/tutorials.test.ts` | completed locally |
| ESLint hygiene worker | low | `website-v2/eslint.config.js`, narrow source files | exclude generated output and fix no-risk lint debt | `npm run lint` | completed locally |
| Token auditor | low/read-only first | styles/components | produce raw value inventory and token split patch plan | drift report | completed locally for protected modules |
| Performance chunk worker | low/mid | `main.tsx`, Vite config, heavy route components | split route bundles and heavy vendor families | build without chunk warning | completed locally |
| Primitive worker | mid | `src/components/ui`, `src/components/site`, stories | normalize Button/Badge/Surface/CodeBlock/Grid | Storybook build + tests | started locally; base UI and public primitive state matrices now gated |
| MCP page worker | mid | `src/pages/MCPPage.tsx`, related data/stories | rebuild MCP page on approved primitives | screenshots + a11y | completed locally for proof route; route-matrix a11y remains |
| SEO/PWA worker | low/mid | metadata registry, public assets | add route metadata, manifest, favicons, OG generation plan | build + metadata tests | SEO metadata/discovery completed locally; PWA/favicons still open |
| Observability/privacy worker | mid | Sentry wrapper, docs/legal | add privacy-first telemetry design | tests + privacy packet | blocked |
| Adversarial reviewer | low/read-only | whole `website-v2` | falsify done claims | failure report first | blocked |

Every worker must receive the live session id, Port Daddy note/claim
instructions, exact write set, no-revert instruction, command gates, and a
handoff with files changed and residual risks.

## Product Truth and Governance

- Claims ledger: missing. Build a data file that ties public claims to repo
  evidence, docs, releases, or roadmap status.
- Pricing/billing truth: not found in current surface; if commercial plans are
  added, pricing source must be single-source and tested.
- Consent/preferences UX: missing. Needed before analytics/replay/Sentry
  performance sampling beyond essential error telemetry.
- Support/security contact: incomplete. Add route/footer support and security
  contact when legal pages land.
- Content owners/update cadence: missing. Blog/docs need owner and stale-date
  policy.
- Product decision records: this plan and decision board are the first record
  for this rehab.

## Observability and Operations

- Sentry or equivalent: not installed in `website-v2`. Add only with DSN env,
  release/env tags, PII scrubbing, source-map policy, and sampling controls.
- Metrics: public site should expose Web Vitals RUM, route engagement, install
  CTA, docs search, copy command, and outbound integration events. Define names
  before implementation.
- Dashboards: missing. Create dashboard spec before adding events.
- Logging: browser logging policy missing.
- Release tagging: missing for public site.
- Environments: local/preview/prod env map missing.
- Feature flags: not needed until experiments or PWA/offline choices.
- Runbooks: missing.
- Rollback: missing.
- PWA: no manifest found; decide if installability is product-appropriate.
- Favicons: only SVG logo assets found, no complete icon matrix.

## Security, Privacy, Reliability

- Threat model: public site is mostly static, but dashboard/live daemon demos,
  comments, docs search, and telemetry require review.
- Data map: missing. Comments endpoint references exist in `BlogComments`; must
  verify whether production backend exists and what data is stored.
- Auth/session model: not applicable to the static public site unless comments
  or dashboards become authenticated.
- Secure headers/CSP: missing from website plan. Add deploy target headers and
  CSP feasibility after external script/media inventory.
- Dependency and third-party scripts: heavy runtime dependencies include
  Mermaid, Three, react-force-graph, asciinema-player, Framer Motion, Radix.
  Bundle splitting is required.
- Secrets handling: Sentry/analytics DSNs must be public-safe env vars.
- Privacy/consent/replay policy: missing.
- Backup/restore: not applicable for static assets; comments/content backend
  must define this separately if live.
- Incident response: missing.
- AI-risk register: needed because product claims center on agentic systems.

## I18n, Inclusion, Sustainability

- Supported locales: English only today.
- Metadata strategy: add `lang`, route titles/descriptions, canonical URLs,
  social metadata, and eventual `hreflang` posture.
- Locale formatting: audit dates/read times/time zones.
- Text expansion/RTL risk: current dense uppercase labels and hardcoded widths
  are fragile.
- Inclusive UX: high-contrast mode should be planned for docs and dashboards.
- Payload budgets: main app chunk should be split; defer heavy visualizations
  and Mermaid until route/component use.
- Low-bandwidth behavior: images need dimensions, responsive sources, and alt
  review.
- Sustainability measurement: track JS/CSS/font/image weight per route.
- AI resource policy: any background agent content process must have budget and
  truth gates.

## Verification Matrix

| Gate | Command or method | Evidence | Status | Risk |
|---|---|---|---|---|
| Typecheck/build | `npm run build` | pass, no chunk warning in latest website build | pass | Mermaid chunk remains near threshold |
| Unit tests | `npm run test` | 82/82 pass | pass | tests do not yet cover PWA/legal/observability |
| Lint | `npm run lint` | pass | pass | raw-value enforcement is still scoped to protected modules |
| Storybook | `npm run build-storybook` | pass, chunk warning; a11y addon runs through `wcag2aaa` | partial | coverage still incomplete outside base/public primitives and MCP route |
| Accessibility | axe/Storybook + Playwright + manual keyboard | MCP proof route and public shell route matrix pass automated axe/focus/overflow gates | partial | manual screen-reader and reduced-motion passes still unproven |
| Public shell accessibility | `npm run test:a11y:shell` | home/docs/MCP/blog desktop+mobile route matrix passes with 0 axe violations and no horizontal overflow | pass | manual screen-reader and reduced-motion passes still needed |
| Mobile screenshots | Playwright screenshots | MCP proof, Swiss mobile, and public shell route matrix recaptured | partial | remaining page-internal route surfaces still need visual review |
| Performance | Vite bundle output, later Lighthouse/Web Vitals | route chunking eliminated Vite warning | partial | needs Lighthouse/Web Vitals and Mermaid follow-up |
| SEO metadata | metadata tests + generated artifacts | route registry, SPA head tags, sitemap, robots, and llms.txt generated from one source | pass | prerender and dedicated OG image generation remain |
| Observability | dependency/config scan | not found | fail | blind production |
| Security/privacy | static inventory | incomplete | pending | data/headers unknown |
| Dependency audit | `npm audit` | not run | pending | unknown |
| Secure headers | deploy config scan | not run | pending | unknown |
| Release/rollback | repo/deploy review | not run | pending | unknown |
| I18n/inclusion | manual + tests | not run | pending | text expansion/contrast |
| Sustainability | bundle/media budget | not run beyond build output | pending | large JS/media |
| Product truth | claims ledger | missing | fail | overclaim risk |

## Pessimistic Execution Order

1. Get user approval on the visual decision board and route preservation map.
2. Repair baseline truth without changing taste:
   - fix tutorial tests
   - exclude generated Storybook output from lint
   - fix no-risk lint errors that block CI
3. Split and enforce the token contract with compatibility aliases.
4. Split route and heavy vendor bundles until the build has no default chunk
   warning.
5. Rebuild the MCP page as the first vertical slice because it has visible
   mobile contrast failure and high drift. Completed for the first proof route
   on 2026-04-26.
6. Layer Swiss-modern structure into the design system: grid primitives,
   measure tokens, flatter elevation, and proof-route migration. Completed for
   the first grid slice on 2026-04-26; broader route migration remains.
7. Normalize base primitives and Storybook state matrices around the MCP proof
   route. Started and gated for base UI/public primitives on 2026-04-26; route
   composites still remain.
8. Normalize docs shell/header/footer so marketing and docs feel like one
   product. Completed for the shared public shell on 2026-04-26; page-internal
   route composites still remain.
9. Normalize blog/editorial cards and dedicated OG image system. Route metadata
   and discovery artifacts are completed for canonical public routes as of
   2026-04-27.
10. Add legal/privacy/support/security-contact pages and product claims ledger.
11. Add observability, Web Vitals, analytics taxonomy, Sentry/privacy controls,
   PWA/favicons if approved.
12. Run adversarial a11y/performance/security/product-truth review.
13. Only then consider deleting legacy/quarantined UI code.

## What Must Not Be Claimed Done Yet

- The site is not production-complete: website lint, tests, build, MCP a11y,
  public shell a11y, and Storybook build are green, but complete Storybook
  matrices, SEO, PWA, legal, observability, and route visual proof work remain.
- The design system is not ideal yet: token layers now exist, but production
  pages still include hardcoded visual values outside protected modules, and
  most routes are not yet on the Swiss grid primitive.
- Accessibility is improved, not done: MCP proof-route and public shell route
  matrix axe/focus/overflow gates now pass, but manual screen-reader and
  reduced-motion passes have not run.
- Performance is improved, not done: the app build no longer warns, but
  Lighthouse/Web Vitals and Storybook bundle work remain.
- SEO/social is improved, not done: canonical metadata, runtime head tags,
  sitemap, robots, LLM discovery, and generated default visual assets now
  exist, but prerendering, full route-specific OG image generation,
  PWA/favicons, legal, and observability are incomplete.
- The existing screenshots are a baseline, not an approval artifact.

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-24 | Created pessimistic rehab plan from ideal-web-app-builder intake | Prepare website stabilization handoff after skill commit/push |
| 2026-04-26 | Recorded token split, route lazy loading, and no-warning build evidence | Keep the pessimistic plan aligned with the second website rehab slice |
| 2026-04-26 | Recorded MCP proof-route rebuild, shared primitive overflow fix, screenshots, and 73/73 test evidence | Keep plan truth aligned after the first visual proof route |
| 2026-04-26 | Added Swiss-modern grid-layer slice, audit findings, proof screenshots, and Storybook evidence | Keep plan truth aligned after layering the Swiss design skill into the system |
| 2026-04-26 | Added Storybook state-matrix and MCP a11y evidence, including WCAG AAA axe tags and refreshed report | Keep plan truth aligned after hardening the component and route accessibility gates |
| 2026-04-26 | Added shared public shell, shell route-matrix a11y gate, contrast-critical role tokens, and refreshed desktop/mobile screenshots | Keep plan truth aligned after unifying the website shell across home/docs/MCP/blog |
| 2026-04-27 | Added SEO metadata/discovery slice, generated sitemap/robots/llms artifacts, and 82/82 test evidence | Keep plan truth aligned after centralizing route metadata and crawler/LLM discovery |
| 2026-04-27 | Added Gemini/Nano Banana generated visual replacement slice, optimized assets, first-viewport browser proof, and 83/83 test evidence | Keep plan truth aligned after replacing the retired sailor hero and generated social fallbacks |
| 2026-04-27 | Removed production `NeumorphicTerminal` and `SailorAgent` surfaces, added rectilinear command/agent primitives, and reran website gates | Keep plan truth aligned after retiring the most explicit old visual metaphors |
