# Port Daddy Website Visual Decision Board

Last updated: 2026-04-26
Status: approved for first stabilization slice; Swiss-modern grid layer and MCP a11y/Storybook proof gates now added
Related plan: `docs/plans/port-daddy-website-ideal-web-app-rehab.md`

The user approved moving forward from this board on 2026-04-26. Do not treat
that as blanket permission to skip slice-level evidence for broad token,
visual, route, content, observability, or legal work.

## Baseline Screenshots

| Surface | Desktop | Mobile |
|---|---|---|
| Home | `docs/reports/website-rehab-screenshots/home-desktop.png` | `docs/reports/website-rehab-screenshots/home-mobile.png` |
| Docs | `docs/reports/website-rehab-screenshots/docs-desktop.png` | `docs/reports/website-rehab-screenshots/docs-mobile.png` |
| MCP | `docs/reports/website-rehab-screenshots/mcp-desktop.png` | `docs/reports/website-rehab-screenshots/mcp-mobile.png` |
| MCP proof | `docs/reports/website-rehab-screenshots/mcp-proof-desktop.png` | `docs/reports/website-rehab-screenshots/mcp-proof-mobile.png` |
| MCP Swiss layer | `docs/reports/website-rehab-screenshots/mcp-swiss-desktop.png` | `docs/reports/website-rehab-screenshots/mcp-swiss-mobile.png` |
| MCP a11y proof | `docs/reports/website-rehab-screenshots/mcp-a11y-desktop.png` | `docs/reports/website-rehab-screenshots/mcp-a11y-mobile.png` |
| Blog | `docs/reports/website-rehab-screenshots/blog-desktop.png` | `docs/reports/website-rehab-screenshots/blog-mobile.png` |

The home-mobile screenshot was retaken after an initial bad capture and now
shows the expected Port Daddy route.

## Visible Diagnosis

1. Home has a recognizable product identity, but the desktop first viewport
   feels under-composed: too much vertical dead air, muted body copy, and a hero
   image that is too washed out to carry the brand. Mobile is more coherent,
   but it still relies on very heavy type and weak secondary action hierarchy.
2. Docs shell has the clearest design thesis: paper, ink, blue, and lime. It is
   readable and memorable, but heavier than the home page and currently feels
   like a separate product shell.
3. MCP mobile has a launch-blocking accessibility issue: body copy nearly
   disappears into the background, and the headline/spacing system feels
   unstable on a narrow viewport.
4. Blog and ecosystem pages carry many one-off style decisions: hardcoded
   color literals, arbitrary radii, `font-black`, oversized headings, and inline
   style usage.
5. Navigation is split between at least two visual systems. Users should not
   feel a brand jump between landing, docs, and product pages.

## Recommended Direction

Approve a single direction: **signal-grade infrastructure editorial**.

This means:

- keep the paper/ink/blue/lime recognizability
- reduce shouting and arbitrary scale jumps
- make the site feel like a serious operator surface, not a generic SaaS page
  and not an uncontrolled poster system
- move all color, radius, type, elevation, motion, and focus decisions through
  a three-layer token contract
- use TypeUI-style inspiration from Refined, Paper, Perspective, and a small
  amount of Neobrutalism, without copying a design kit blindly
- layer in Swiss-modern discipline from the local skill: 12-column grids,
  typographic hierarchy, disciplined asymmetry, flatter surfaces, exact
  measures, and scarce accent use without turning the brand grayscale

## Decisions Needed

| Decision | Recommended choice | Alternatives | Why it matters |
|---|---|---|---|
| Brand register | Signal-grade infrastructure editorial | Full neobrutalist poster, generic polished SaaS, maritime mascot-forward | Controls typography, density, imagery, and content voice. |
| Shape system | Mostly square protocol panels with a small integral radius ladder | Zero radius everywhere, large pill/blob radii | Current route mix is visibly inconsistent. |
| Typography | One high-quality sans/display family plus technical mono; role-specific weights | Keep `font-black` everywhere, buy a distinctive display face immediately | Type is the fastest path to making the site feel intentional. |
| Color system | Source palette in token files only, semantic/role tokens everywhere else | Keep arbitrary page-level colors | Required for WCAG, dark mode, and maintainability. |
| Grid system | 12-column Swiss editorial grid primitive for new proof slices | Keep local `grid-cols-*` math in every page | Prevents arbitrary widths from rebuilding drift route by route. |
| Route strategy | Preserve broad current route surface, stabilize and normalize in slices | Replace with tiny site, delete old pages | Current recovery notes warn against another replacement reset. |
| MCP page | First route replacement slice | Defer until later | It has visible mobile contrast failure and large drift. |
| PWA | Add manifest/favicons; decide offline scope after content audit | Skip PWA entirely | A docs/product tool can benefit from installability, but offline caching has correctness risks. |
| Observability | Privacy-first Sentry/Web Vitals behind env and consent policy | No browser telemetry | Production polish requires knowing real errors and Web Vitals. |

## Proposed Route Impact Map

| Route | Preserve | Normalize | Replace | Defer |
|---|---:|---:|---:|---:|
| `/` | yes | yes | no | no |
| `/docs`, `/docs/**` | yes | yes | no | no |
| `/mcp` | behavior yes | no | yes | no |
| `/tutorials/**` | yes | yes | no | no |
| `/blog`, `/blog/:slug` | yes | yes | no | no |
| `/integrations/**` | yes | yes | no | later |
| `/templates/**` | yes | yes | no | later |
| `/cookbook/**` | yes | yes | no | later |
| `/dashboard` | yes | audit first | maybe | later |

## Component Migration Map

| Current pattern | Target | Risk |
|---|---|---|
| Page-level `font-black`, `tracking-tighter`, `leading-[0.85]` | `PanelTitle`, `HeroTitle`, `SectionTitle` roles | medium; visual feel changes quickly |
| Inline styles using `var(...)` in pages | role-token component props/classes | medium; many files touched |
| Hardcoded provider colors in MCP page | provider role tokens with contrast tests | low/medium |
| Arbitrary radii like `rounded-[60px]`, `rounded-[100px]` | integral radius tokens | low |
| Global route metadata defaults | route metadata registry and OG image system | medium |
| Storybook stories for primitives only | state matrix for primitives and key composites | medium |

## First Approved Execution Slice

Approved and partly executed on 2026-04-26:

1. Stabilize CI truth:
   - repair tutorial tests and canonical route order
   - exclude `storybook-static` from lint
   - fix no-risk lint blockers
   - status: complete; `npm run lint`, focused tutorial tests, full tests, and
     `npm run build` now pass, with a remaining large-main-chunk warning
2. Split token layers with compatibility aliases.
3. Add Swiss-modern structural layer:
   - source and role tokens for grid columns, grid gaps, and copy measures
   - shared `SwissGrid` and `SwissGridItem` primitives
   - flatter public elevation tokens
   - status: complete for the first MCP proof route slice
4. Normalize Button, Badge, Surface, CodeBlock, SiteHeader, and Docs shell
   stories.
   - status: started; base UI and public primitive state matrices are now
     wired into Storybook and the design-system contract
5. Rebuild `/mcp` as the proof slice.
6. Capture desktop/mobile screenshots and run a11y/perf gates before touching
   the next route.
   - status: complete for `/mcp`; `npm run test:a11y:mcp` records 0 axe
     violations, keyboard roving-tab coverage, visible focus, and no
     horizontal overflow

## Approval Checklist

- Brand register approved for first slice.
- Shape/radius posture approved for first slice.
- Typography direction approved enough to continue research and shortlist.
- Color posture approved enough to plan source/semantic/role tokens.
- Route preservation map approved.
- First execution slice approved and CI stabilization completed.
- Swiss-modern grid layer approved by follow-up request and applied to the MCP
  proof route with desktop/mobile screenshots.
- MCP proof-route a11y and Storybook gates now have concrete evidence:
  11/11 focused contract tests, 74/74 full website tests, Storybook build, and
  `docs/reports/website-rehab-a11y/mcp-a11y-report.json`.
- Cheap subagent fanout approved for bounded write sets after the first slice.
