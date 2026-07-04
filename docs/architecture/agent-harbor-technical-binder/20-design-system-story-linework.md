# 20 Design System: Story Linework

Status: approved by the operator, 2026-07-04. This chapter encodes the design
system developed on PR #657 (`docs/design/story-linework/`) as binder truth so
every surface build cites one authority. The living artifacts — self-rendering
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
each in light and dark. Full generation prompts live in the PR #657 history;
the style paragraph above is the contract.

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
inherits palette v2 with zero code change. Favicon candidates: Kilo halves,
Papa square, Uniform quarters at 32px (operator to pick one).

## Surface application (normative mocks in apps.html)

FleetBar: gate queue on top in violet (ch19: the only attention demand),
one cobalt zone, berth lanes. pd-console: layer-hued pane rail, brackets on
the live pane, X-ray on gates, hot-bus latency in the status bar. Control
Center: budget as a gold block, Papa empty states, micro-flag activity rail.
CLI: box-glyph corner ticks, half-block stripes, reverse-video zones,
voice-procedure chips; `NO_COLOR`/`!isTTY`/`--json` strip to plain.

## Image overhaul plan (phased, each phase one PR)

- **W0 — tokens + linework.css into website-v2** (palette v2/v2.1 diff from proposal §05, brand-doc lockstep test updated; rollout tasks R·0–R·4 from the proposal).
- **W1 — identity**: recolored mark SVGs shipped, SpinningWordmark verified against new tokens, favicon cut, OG template wired into the og-card generator (color-rollout task 7 superseded by `og.html`).
- **W2 — hero art**: regenerate the ~12 route-level heroes (manifesto, library, pr-fleet done; cli-backend trio, blog masthead, pd-tube, scout, security, mac-preview) in the cut-paper style, light+dark pairs, wordless.
- **W3 — blog covers**: ~18 post heroes regenerated in style; retired-post art left as-is.
- **W4 — example artwork**: already the style's origin; regenerate only the off-palette ones (audit against palette lock).
- **W5 — app assets**: pd-console launcher art, FleetBar berth icons, Control Center empty states from the same prompts at asset sizes.
- Each phase gates on: brand-color guard, wordless check (visual), palette-lock spot check, both themes shipped together.

## Relationship to earlier chapters

Ch01/ch19's authority rule gets its visual corollary here: surfaces differ in
affordance, never in authority — and now never in vocabulary. Ch05's Harbor
co-edit adopts this system's claim stripes, letter-flag cursors, and
voice-procedure parley chips as its target rendering (mock M·F in apps.html).
