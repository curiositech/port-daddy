# Port Daddy Website Ideal Web App Rehab Plan

Last updated: 2026-04-24
Owner session: `session-80296aef-bf46-4457-b900-b7c9ca9c92fe`
Skill contract: `ideal-web-app-builder`
Status: intake complete enough for user visual review; broad execution not approved yet

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
- Dirty files to preserve: none in `git status` after the skill commit/push.
  Ignored local residue under `website-v2/` includes `dist/`,
  `storybook-static/`, logs, `.DS_Store`, and local helper scripts.

## Current-State Intake

- Branch: `main`, in sync with `origin/main` after pushing `3ef7224`.
- Recent commits:
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
| Build | Pass with warning | `dist/assets/index-CN56fPdw.js` is 1,990.71 kB minified / 532.82 kB gzip; Vite warns about chunks over 500 kB. |
| Tests | Fail | `src/data/tutorials.test.ts`: 20 failed, 49 passed. Failures are tutorial totals/order, prev/next symmetry, numeric prop format, title drift, and orphaned `SemanticIdentities`. |
| Lint | Fail | 75 errors / 18 warnings. Major groups: generated `storybook-static` not ignored by ESLint, React compiler rules, `Math.random()` during render, fast-refresh export boundaries, `any` types, stale disabled rule `no-unsanitized/property`, and content string escapes. |
| Storybook build | Pass with warning | Build succeeds, but preview iframe chunk is 1,080.43 kB / 304.51 kB gzip and Storybook reports missing package metadata for `radix-ui`. |
| Screenshot baseline | Captured | `docs/reports/website-rehab-screenshots/`. |

## Screenshot Baseline

- Home desktop: `docs/reports/website-rehab-screenshots/home-desktop.png`
- Home mobile: `docs/reports/website-rehab-screenshots/home-mobile.png`
- Docs desktop: `docs/reports/website-rehab-screenshots/docs-desktop.png`
- Docs mobile: `docs/reports/website-rehab-screenshots/docs-mobile.png`
- MCP desktop: `docs/reports/website-rehab-screenshots/mcp-desktop.png`
- MCP mobile: `docs/reports/website-rehab-screenshots/mcp-mobile.png`
- Blog desktop: `docs/reports/website-rehab-screenshots/blog-desktop.png`
- Blog mobile: `docs/reports/website-rehab-screenshots/blog-mobile.png`

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
- Blog and MCP carry many hardcoded style decisions and should be normalized
  after the system contract is approved.

## Visual Decision Review

- Review artifact: `docs/plans/port-daddy-website-visual-decision-board.md`
- Approval status: pending user review.
- Approval date: not approved.
- Rule: do not execute broad visual, route, content, or token rewrites until
  the user approves or amends the decision board.

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
     `--hero-*`, `--code-*`, `--chart-*`, `--og-*`

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
| Tutorial system | failing tests around totals, numbering, prev/next, orphan route | preserve behavior, fix truth | repair canonical `tutorials.ts` and page props before visual fanout | pending |
| ESLint config | lints ignored Storybook output; many real source issues mixed with generated noise | normalize | exclude generated dirs first, then fix real source categories | pending |
| Token files | source, semantic, and role tokens are interleaved | normalize | split token layers, keep compatibility aliases, add drift tests | pending |
| MCP page | hardcoded provider colors, inline styles, mobile AAA failure | replace | rebuild on approved primitives and token roles | pending |
| Storybook | exists but state coverage is shallow | normalize | add component matrices and a11y addon after primitives stabilize | pending |
| SEO/meta | app-wide defaults plus limited title/description hook; no per-route OG images | replace | route metadata registry, generated social images, sitemap/robots | pending |
| PWA/favicons | minimal assets; no manifest discovered | add if approved | app.webmanifest, icon set, offline strategy decision | pending |
| Observability | no Sentry/browser telemetry setup found | add if approved | privacy-first Sentry wrapper, release tags, scrub rules, dashboards | pending |
| Legal/privacy | no complete terms/privacy route found | add | product-specific terms/privacy/support/security-contact pages | pending |

## Sessions and Ownership

| Session | Owner | Scope | Files | Status | Notes |
|---|---|---|---|---|---|
| `session-80296aef-bf46-4457-b900-b7c9ca9c92fe` | Codex | intake, plan, screenshots, decision board | docs plan files, `website-v2` | in progress | no broad code edits yet |
| future 1 | lead | approve visual direction and lock token contract | docs plan, token files | pending | user approval required |
| future 2 | worker swarm | tutorial/lint/build stabilization | tutorial/data/lint files | blocked | after approval |
| future 3 | worker swarm | primitives and Storybook state matrix | components/styles/stories | blocked | after token contract |
| future 4 | worker swarm | route/page normalization | page dirs by route | blocked | disjoint write sets |
| future 5 | reviewers | a11y/perf/security/privacy/product truth | read-mostly | blocked | adversarial gates |

## Cheap Subagent Execution Plan

Use only after the user approves the visual decision board.

| Agent | Cost tier | Write set | Task | Gates | Status |
|---|---|---|---|---|---|
| Tutorial repair worker | low/mid | `website-v2/src/pages/tutorials`, `website-v2/src/data/tutorials.ts`, tests | repair tutorial order/nav truth | `npm run test -- src/data/tutorials.test.ts` | blocked |
| ESLint hygiene worker | low | `website-v2/eslint.config.js`, narrow source files | exclude generated output and fix no-risk lint debt | `npm run lint` | blocked |
| Token auditor | low/read-only first | styles/components | produce raw value inventory and token split patch plan | drift report | blocked |
| Primitive worker | mid | `src/components/ui`, `src/components/site`, stories | normalize Button/Badge/Surface/CodeBlock | Storybook build + tests | blocked |
| MCP page worker | mid | `src/pages/MCPPage.tsx`, related data/stories | rebuild MCP page on approved primitives | screenshots + a11y | blocked |
| SEO/PWA worker | low/mid | metadata registry, public assets | add route metadata, manifest, favicons, OG generation plan | build + metadata tests | blocked |
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
| Typecheck/build | `npm run build` | pass, chunk warning | partial | large JS |
| Unit tests | `npm run test` | 20 failures in tutorials test | fail | route truth drift |
| Lint | `npm run lint` | 75 errors, 18 warnings | fail | generated output mixed with real issues |
| Storybook | `npm run build-storybook` | pass, chunk warning | partial | coverage shallow |
| Accessibility | axe/Storybook + Playwright + manual keyboard | not run | pending | known MCP contrast failure |
| Mobile screenshots | Playwright screenshots | captured, one suspect home mobile artifact | partial | retest needed |
| Performance | Vite bundle output, later Lighthouse/Web Vitals | large chunks | fail | hydration/bundle cost |
| SEO metadata | static scan | global defaults only | fail | weak route metadata |
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
4. Normalize base primitives and Storybook state matrices.
5. Rebuild the MCP page as the first vertical slice because it has visible
   mobile contrast failure and high drift.
6. Normalize docs shell/header/footer so marketing and docs feel like one
   product.
7. Normalize blog/editorial cards, route metadata, and OG image system.
8. Add legal/privacy/support/security-contact pages and product claims ledger.
9. Add observability, Web Vitals, analytics taxonomy, Sentry/privacy controls,
   PWA/favicons if approved.
10. Run adversarial a11y/performance/security/product-truth review.
11. Only then consider deleting legacy/quarantined UI code.

## What Must Not Be Claimed Done Yet

- The site is not stable: tests and lint are red.
- The design system is not ideal: tokens are not cleanly layered and production
  pages still use hardcoded visual values.
- Accessibility is not acceptable: MCP mobile has visible contrast failure and
  focus/keyboard gates have not run.
- Performance is not acceptable: build and Storybook have large chunks.
- SEO/social/PWA/legal/observability are incomplete.
- The existing screenshots are a baseline, not an approval artifact.

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-24 | Created pessimistic rehab plan from ideal-web-app-builder intake | Prepare website stabilization handoff after skill commit/push |
