# 20 Design System: Story Linework

Status: design decisions approved by the operator in PR #657 review
(2026-07-04); this chapter becomes binder truth when that PR merges, and the
rollout (W0-W5) lands as separate PRs. It encodes the design system developed
in `docs/design/story-linework/` so every surface build cites one authority. The living artifacts — self-rendering
spec pages — are the normative source for exact values:

- `docs/design/story-linework/proposal.html` — palette v2/v2.1, WCAG + surface-adjacency studies, type options, linework primitives, blocking dial, route→flag map
- `docs/design/story-linework/ports/` — five marketing-page ports + `port.css` (the reference implementation of every token and utility)
- `docs/design/story-linework/apps.html` — FleetBar, pd-console, Fleet Control Center, the pd CLI, and the Harbor co-edit target, plus the cross-runtime token mapping
- `docs/design/story-linework/og.html` — OG-card template, mark recolor, favicon candidates
- `docs/design/story-linework/art/` — the blessed cut-paper art set

## The system in one paragraph

Palette v2 maps every hue to a layer of the ADR-0048 stack (cobalt L0 truth,
sage L1 ready, teal L2 legibility, gold L3 economy; indigo federation, rust
reputation, violet identity; amber warning, signal-red error), with all
semantic pairs CIEDE2000-separated ≥ 16.8 and every text use WCAG AA in both
themes. Fractional linework carries structure (corner brackets on live panels
only, 3px state stripes, midline rules, one color zone per view); Vignelli
blocking carries composition (edge-bleeding slabs, knockout headlines whose
glyphs flip color at the block edge, one-filled-cell grids); the International
Code of Signals carries meaning (micro-flag state chips, slug hoists, one
giant flag per page placed where its signal meaning is literally true). Type
is IBM Plex with Recursive's casual axis as the play voice for display
em-phrases. Illustration is the cut-paper harbor style. The token file's
`--signal-*` and `--voice-*` names, dormant since PR #455, are now drawn.

## Hard rules (violations are defects)

1. Story hues are accents, never chrome; brackets and midlines are always ink.
2. One color zone per view; a second concurrent thing pulses in the list.
3. Amber is never small text on cream (3.71:1); stripes, dots, display, or `-on-tint` only.
4. Slabs and knockout blocks use the `--*-slab` cuts with cream text in both themes; washes are `color-mix` 10%.
5. Cards sit on the `strong` well in light with a mandatory hairline edge (raised-on-base is an invisible 1.046:1).
6. Line weights: 1px texture, 1.5px linework, 2px enclosure — never adjacent-mixed.
7. A page's giant flag must hold content or carry the masthead, never a divider band; flag whites are `--flag-white #fbf7ef`, theme-independent.
8. State is never color alone: stripe + dot + micro-flag + label + relative time.
9. Pulse rings animate only while work is in flight; `prefers-reduced-motion` freezes to a still.
10. Generated imagery is wordless (labels as blank paper strips) and palette-locked.

## The cut-paper art style (blessed 2026-07-04)

Handcrafted cut-paper diorama, macro, shallow depth of field; layered matte
cardstock with visible thickness and knife-cut edges on a cream (`#f2eee6`,
warm studio light) or near-black (`#101216`, low-key + cool rim light) paper
tabletop; strict palette-v2 color discipline; Swiss composition (one hero
subject, negative space, invisible grid); entirely wordless. Reference set in
`art/`: pr-fleet, manifesto harbor (the L0→L3 terraced quays), library wall —
each in light and dark. Full generation prompts are committed at
`docs/design/story-linework/art/PROMPTS.md`; the style paragraph above is the
contract.

## OG cards

Composited, not generated whole: 1200×630 HTML template (`og.html`) with the
route's slug hoist, display title with one accent em-word, mono subline, the
recolored mark + wordmark + URL, a Kilo spine (or the page-flag's hue pair)
dividing text from a cut-paper art panel. Light and dark variants per route.

## Mark, wordmark, favicon

The existing radar-mark SVGs and the SpinningWordmark component are kept as
drawn; only colors change. Static SVGs: blue→cobalt, green→teal/sage,
amber→lime, grays→warm surface tokens (`art/pd-mark-v2-*.svg`). The
color-shifting "pd" already reads `--c1/--c2/--c3` from brand tokens, so it
inherits palette v2 with zero code change. Operator decisions (2026-07-04):
OG system approved; **wordmark unchanged; favicon unchanged** (the flag
favicon candidates in `og.html` are archived, not adopted).

## Surface application (normative mocks in apps.html)

FleetBar: gate queue on top in violet (ch19: the only attention demand),
one cobalt zone, berth lanes. pd-console: layer-hued pane rail, brackets on
the live pane, X-ray on gates, hot-bus latency in the status bar. Control
Center: budget as a gold block, Papa empty states, micro-flag activity rail.
CLI: box-glyph corner ticks, half-block stripes, reverse-video zones,
voice-procedure chips; `NO_COLOR`/`!isTTY`/`--json` strip to plain.

Adopted 2026-07-04 (parley punch item 5; normative mocks in
`docs/design/2026-07-05-surface-redesign/mockups-ch20/` <!-- cite-exempt: lands with PR #691 -->, fork rulings recorded
there): FleetBar's gate queue is **state-dependent** — it does not render when
empty; when armed it renders above the intent composer as the view's one color
zone. Four more surfaces join the set:

- **Scout** (browser intake wedge): evidence hero with gold region economics,
  the three honest daemon-chip states (online / degraded / offline with its
  remediation on the face), a closed annotation taxonomy, and the routed-shape
  confirmation showing the Work Intent id. Intake only; deep-links to console.
- **Login** (storefront): the trust model in one screen — local-first honesty
  well, OIDC primary, the 4-digit pairing ritual under a Quebec masthead
  (pratique: requesting permission to enter), no-custodial-keys truths, one
  cobalt knockout slab.
- **Account** (storefront): keyring / receipt drawer / consent ledger — violet
  edges identity artifacts only, gold marks money (receipts, the plan's
  gold-slab price plate, caps "enforced by YOUR daemon, mirrored here"),
  Kilo masthead on device pairing, error hue reserved for revoke/delete.
- **Harbor remote view** (storefront sibling of the co-edit dream): the same
  dark buffer mirrored read-only with claims as line-range stripes and the
  hatched semantic-conflict forecast band; radio-voice parley chips
  (SÉCURITÉ teal, PAN PAN amber-on-tint); a salvage tide-line; the durable
  ledger tail; stale-truth chips for remote devices; Victor flying over the
  contested range because its meaning is literally true.

## Image overhaul plan (phased, each phase one PR)

- **W0 — tokens + linework.css into website-v2** (palette v2/v2.1 diff from proposal §05, brand-doc lockstep test updated; rollout tasks R·0–R·4 from the proposal).
- **W1 — identity**: recolored mark SVGs shipped, SpinningWordmark verified against new tokens, favicon cut, OG template wired into the og-card generator (color-rollout task 7 superseded by `og.html`).
- **W2 — hero art**: regenerate the ~12 route-level heroes (manifesto, library, pr-fleet done; cli-backend trio, blog masthead, pd-tube, scout, security, mac-preview) in the cut-paper style, light+dark pairs, wordless.
- **W3 — blog art, full port** (measured: 18 posts, ~50 inline figures, 20 Mermaid blocks):
  - every hero AND inline figure regenerated in the cut-paper style, shipped as light/dark pairs (`ThemedImage` already swaps on theme);
  - every raster figure also generated in a portrait variant; served via `<picture media="(orientation: portrait)">` so phones get the vertical cut;
  - Mermaid gains true light/dark theme pairs — the theme-independent "diagram paper" tokens are retired in favor of `--diagram-*` values defined per theme, AA-checked like every other pair;
  - a shared `FigureFrame` component wraps all figures (raster + Mermaid): hairline-edged, caption slot, click-to-lightbox with scroll/pinch zoom and drag pan, orientation-aware source selection, `prefers-reduced-motion` honored on the zoom transition;
  - retired-post art left as-is.
- **W4 — example artwork**: already the style's origin; regenerate only the off-palette ones (audit against palette lock).
- **W5 — app assets**: pd-console launcher art, FleetBar berth icons, Control Center empty states from the same prompts at asset sizes.
- Each phase gates on: brand-color guard, wordless check (visual), palette-lock spot check, both themes shipped together.

## Amendment 1 — parley arbitration (operator, 2026-07-04)

Three forks between this chapter and PR #671/#658 were arbitrated:

- **A·1 dark substrate: near-black `#101216` confirmed** (palette v2 as shipped). #671's warm-ebony proposal declined; warmth lives in the light theme's cream.
- **A·2 display face: Plex confirmed, plus a narrow Big Shoulders Display license** — pd-console pane titles and poster/OG display moments ONLY, never site display or body. Caps-only faces stay out of the mixed-case display voice.
- **A·3 flag→state map: `lib/maritime-signals.ts` is the referee and its canonical map WINS** over this chapter's draft chips. Binding: H=claim-active, Y=claim-stale, F=awaiting-human (this covers release gates), B=burning-cash, V=conflict, D=blocked, M=idle, A=spawning, P=fleet-healthy, J=mayday, R=inform, K=request, N=refuse/negative, C=affirmative. This chapter's earlier chips are corrected: Quebec-as-healthy → **Papa=fleet-healthy**; Lima-as-blocked → **Delta=blocked**; X-ray-as-gate → **Foxtrot=awaiting-human**. Extensions where the lib is silent remain from this chapter: **Uniform=warn** ("you are running into danger") and the per-route giant/masthead flags (Kilo home, Oscar blog, Papa examples, India library, Golf cli-backend — a page-identity namespace, not state chips). Every surface renders state flags through `lib/maritime-signals.ts`; no surface hand-picks letters.

## Relationship to earlier chapters

Ch01/ch19's authority rule gets its visual corollary here: surfaces differ in
affordance, never in authority — and now never in vocabulary. Ch05's Harbor
co-edit adopts this system's claim stripes, letter-flag cursors, and
voice-procedure parley chips as its target rendering (mock M·F in apps.html).
