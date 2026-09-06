# Port Daddy Brand — current palette

> **Source of truth:** `website-v2/src/styles/tokens.semantic.css`.
> This document is a human-readable companion. A vitest contract
> (`src/design-system-contracts.test.ts → brand-doc matches tokens`)
> fails CI if any hex value below drifts from the CSS. If you change
> a brand color, change both the token AND this doc in the same
> commit.

## Palette

Modern infrastructure neutral: warm-cream surfaces, cobalt blue brand
primary, deep teal accent. Light mode reads like architectural paper.
Dark mode is true near-black with luminous cobalt and sage. Status
colors map to maritime signal flags (`--signal-charlie/november/…`)
for the dogfooded coordination vocabulary.

### Light theme

| Token | Hex | Role |
|---|---|---|
| `--surface-base` | `#f2eee6` | Page background — warm cream |
| `--surface-raised` | `#f7f3eb` | Cards, panels |
| `--surface-strong` | `#e9e2d5` | Inset wells, code header background |
| `--surface-sunken` | `#e0d9cb` | Deepest fill |
| `--text-primary` | `#121212` | Body copy, headings |
| `--text-secondary` | `#403b34` | De-emphasised body |
| `--text-muted` | `#47423a` | Meta, captions |
| `--text-inverse` | `#fbf7ef` | Text on dark fills |
| `--brand-primary` | `#003fb8` | Cobalt — primary CTAs, links, focus |
| `--brand-primary-on-tint` | `#002d83` | Cobalt on tinted background |
| `--brand-secondary` | `#1f1f1f` | Near-black ink for emphasis |
| `--brand-accent` | `#006b5f` | Deep teal — secondary accent, success-adjacent |
| `--brand-accent-on-tint` | `#004a42` | Teal on tinted background |
| `--brand-primary-foreground` | `#fbf7ef` | Text on brand-primary fill |
| `--border-strong` | `#121212` | Hard black borders (2px standard) |
| `--interactive-focus` | `#0055ff` | Focus ring |
| `--status-success` | `#2d7a43` | Charlie — green |
| `--status-warning` | `#a66f00` | Uniform — amber |
| `--status-error` | `#bf2f2f` | November — signal red |
| `--status-info` | `#0055ff` | Kilo — blue |
| `--chart-yellow` | `#cad900` | Highlight tier in diagrams (no brand-slot equivalent) |
| `--story-health` | `#1f7a4d` | Sage green — L1 ready/coordinated (150°) |
| `--story-health-on-tint` | `#155534` | Health on tinted wells |
| `--story-indigo` | `#353a85` | Indigo — L1→L3 protocol/federation (236°, deep slate blue-violet) |
| `--story-indigo-on-tint` | `#262a63` | Indigo on tinted wells |
| `--story-violet` | `#933fa5` | Violet — L3 identity/continuity, the "person" (289°, clear purple) |
| `--story-violet-on-tint` | `#6b2e79` | Violet on tinted wells |
| `--story-rust` | `#7a4514` | Rust — L3 reputation/Elo, trust earned (29°) |
| `--story-rust-on-tint` | `#5a3210` | Rust on tinted wells |
| `--story-gold` | `#666a00` | Gold — L3 economy/value, the market (62°; not the warning amber) |
| `--story-gold-on-tint` | `#4d5000` | Gold on tinted wells |

### Dark theme

| Token | Hex | Role |
|---|---|---|
| `--surface-base` | `#101216` | Page background — near-black |
| `--surface-raised` | `#181c22` | Cards, panels |
| `--surface-strong` | `#222833` | Inset wells |
| `--surface-sunken` | `#0b0d11` | Deepest fill |
| `--text-primary` | `#f5f3ed` | Body copy, headings |
| `--text-secondary` | `#d3cec2` | De-emphasised body |
| `--text-muted` | `#a59f93` | Meta, captions |
| `--brand-primary` | `#7db4ff` | Luminous cobalt — primary CTAs, links |
| `--brand-secondary` | `#f5f3ed` | Bright ink for emphasis |
| `--brand-accent` | `#8fd0a7` | Sage — secondary accent |
| `--border-strong` | `#f5f3ed` | Hard light borders |
| `--status-success` | `#66d28a` | |
| `--status-warning` | `#f2be51` | |
| `--status-error` | `#ff7d7d` | |
| `--status-info` | `#7db4ff` | |
| `--story-health` | `#5fce97` | Luminous sage — L1 ready |
| `--story-health-on-tint` | `#adf3c2` | Health on tinted wells |
| `--story-indigo` | `#8a8af8` | Luminous indigo — federation |
| `--story-indigo-on-tint` | `#b5b5fb` | Indigo on tinted wells |
| `--story-violet` | `#e0a5ed` | Luminous violet — identity/continuity |
| `--story-violet-on-tint` | `#eec9f5` | Violet on tinted wells |
| `--story-rust` | `#b98e6b` | Luminous rust — reputation/Elo |
| `--story-rust-on-tint` | `#d6b697` | Rust on tinted wells |
| `--story-gold` | `#d8dd3c` | Luminous gold — economy/value |
| `--story-gold-on-tint` | `#f5fa78` | Gold on tinted wells |

## Voice + signal vocabulary

The semantic layer maps colors to maritime/comms metaphors:

- `--signal-charlie / november / kilo / uniform / victor / lima` — signal flags onto status roles
- `--voice-mayday / pan-pan / securite / hail / roger / wilco / report / over / out` — radio voice procedures onto urgency/status tiers
- `--channel-scope / topic / qualifier / sep` — color the parts of a `topic:scope` channel name

These exist so coordination UI (FleetBar, Guard, Fleet Control Center)
can paint state without inventing ad-hoc palettes. Read
`tokens.semantic.css` for the full mapping.

## The story palette — color as the ADR-0048 stack

The radar logo brought a yellow/amber accent into the brand. Rather than let
amber float as a one-off, the palette was rounded out into a harmonious wheel
where **every hue carries a meaning tied to a layer of the [ADR-0048](../../../docs/adr/0048-what-port-daddy-is.md)
stack** (L0 daemon → L1 protocol → L2 legibility → L3 economy). Color *tells the
product's story*: legibility, accountability, and the path from a kernel of
truth to a market of trusted persons.

### Hue map (light-mode foreground anchors)

| Hue | Token | Layer | Meaning |
|---|---|---|---|
| 0° red | `--status-error` `#bf2f2f` | the Leviathan | breach / mayday — the consented authority says *stop* |
| 29° rust | `--story-rust` `#7a4514` | L3 | reputation / Elo — **trust earned** over a continuous history |
| 40° amber | `--status-warning` `#a66f00` | — | warning — stripes, dots and display sizes only; amber *text* uses `--status-warning-on-tint` (3.71:1 on cream fails AA for small text) |
| 62° gold | `--story-gold` `#666a00` | L3 | economy / value — the radar-logo accent grown up; the market |
| 64° lime | `--chart-yellow` `#cad900` | — | highlight tier in diagrams (no semantic role) |
| 150° sage | `--story-health` `#1f7a4d` | L1 | ready / coordinated — agents in good standing, healthy fleet |
| 173° teal | `--brand-accent` `#006b5f` | L2 | **legibility** — the product itself; the digest-with-zoom |
| 220° cobalt | `--brand-primary` `#003fb8` | L0 | **truth / kernel** — the SQLite source of truth, the daemon |
| 236° indigo | `--story-indigo` `#353a85` | L1→L3 | protocol / federation — the rules of the road across harbors |
| 289° violet | `--story-violet` `#933fa5` | L3 | **identity / continuity** — memory → checkpoint → a *person* |

### Color-theory rationale

- **Two analogous arcs, one complementary axis.** The warm arc
  (danger → rust → amber → gold → lime, 0–64°) reads as *alarm → value →
  economy*. The cool arc (health → teal → cobalt → indigo → violet, 150–289°)
  reads as *ready → legible → true → federated → continuous*. Palette v2
  (`website-v2/public/design-preview/proposal.html`) re-derived indigo, violet and rust so
  every semantic pair clears a CIEDE2000 gap of at least 14.6 in both themes,
  and minted gold so the economy stops borrowing the warning token. The Book's
  TeX palette (`website-v2/public/whitepaper/figures/pd-palette.tex`) mirrors the light values one-for-one;
  `website-v2/scripts/check-figure-palette.mjs` fails the build if they drift. The two arcs sit roughly
  **opposite** on the wheel — cobalt (220°) is the near-complement of amber
  (40°), so the kernel (truth) and the economy (value) frame the system from
  both sides. That complementary tension is the brand's core: *local truth*
  vs. *traded value*.
- **The new hues fill the wheel's two gaps.** Before this pass the anchors left
  an 86° hole between lime (64°) and teal (173°) and a 40°+ hole past cobalt
  (220°). `--story-health` (150°) closes the green gap; `--story-indigo` (248°)
  and `--story-violet` (261°) close the violet gap. The result is even, rhythmic
  spacing (Δ ≈ 20–25° between neighbours) with two intentional wide jumps that
  separate the warm/economy cluster from the cool/state cluster.
- **Indigo + violet are analogous on purpose.** They sit 13° apart because they
  are *the same story* — protocol/federation flows into identity/continuity
  (ADR-0048's "memory → person → reputation → market" through-line). Federation
  is the slightly cooler, more structural sibling; violet is the warmer, more
  human one.
- **Saturation stays disciplined.** New light-mode hues hold L≈30–48 / moderate
  chroma so they sit as *ink on cream*, never as candy. Dark-mode variants are
  lightened (L≈59–77) to stay luminous on near-black without glowing.

### Contrast (WCAG)

Every story color clears **AA (≥4.5)** as foreground text on both
`--surface-base` and `--surface-raised`, in both themes, and clears AA as a
white/cream-text fill (badges, buttons). Light-mode foregrounds land
4.6–7.6; dark-mode foregrounds 6.2–9.6; all `*-on-tint` companions 6.8–11.5.
Re-verify with `node scripts/check-brand-colors.mjs` (guards retired hexes)
and the `design-system-contracts.test.ts` brand-doc/token lockstep test.

### Usage

- Use the **`--layer-*`** aliases (`--layer-l0-kernel`, `--layer-l1-protocol`,
  `--layer-l2-legibility`, `--layer-l3-economy`, `--layer-federation`,
  `--layer-reputation`, `--layer-value`) when painting **stack diagrams, layer
  badges, and the "what Port Daddy is" table** — pick the layer, not the hex.
- Use the **`--story-*`** tokens directly for **feature accents** that map to a
  concept: a fleet-health scorecard in `--story-health`, a reputation/Elo badge
  in `--story-rust`, an identity/resurrection surface in `--story-violet`, a
  federation/Alice's-fleet view in `--story-indigo`.
- Reach for `*-on-tint` when the color sits on a tinted well
  (`--surface-strong`); reach for `*-foreground` for text *on* a filled chip.
- Story colors are **accents, not chrome** — surfaces stay warm-cream/near-black,
  borders stay `--border-strong`. The story palette decorates state and meaning;
  it never becomes the page background.

## Forbidden phrases (historical anchors that no longer apply)

These names referred to a retired palette and visual language. If you
see them in commentary, blog hero prompts, or memory, they are stale —
verify against this doc and `tokens.semantic.css` before acting.

- "Harbor Heritage" — the prior sandstone/cinnabar/ebony palette
- "Cinnabar red", "sandstone base", "warm ebony"
- "Maritime palette" (the *vocabulary* is maritime; the *colors* are not warm-wood)
- "Neumorphic" — the system is flat (no raised shadows; borders do all separation work). `--shadow-*` tokens all resolve to `none`.

## Visual language

- **Flat, not skeuomorphic.** All `--shadow-*` tokens are `none`. Separation comes from 2px borders, alternating surfaces, and spacing — never raised drop-shadows.
- **Hard borders are load-bearing.** Sections, panels, and cards use `border-2 border-[var(--border-strong)]`. This is the figure-ground mechanism. Don't add rounded corners (`rounded-2xl`/`rounded-full`) unless rendering a system primitive (avatar, badge) that genuinely calls for it.
- **Type is editorial.** `--font-display` for headlines, `--font-sans` for body, `--font-mono` for command/code/channel strings. Sizes through `--type-*` tokens.
- **Illustration is architectural-blueprint.** Crisp linework, hatching for shading, hand-lettered italic labels. Not painterly cinematic. Canonical reference: `public/img/generated/_brand-reference/style-ref-blueprint.png` (not yet shipped — generate and commit when the next blueprint illustration lands).

## When in doubt

1. `cat website-v2/src/styles/tokens.semantic.css` — the source of truth
2. Open the live site in both light and dark and read what's actually there
3. Don't trust historical chat logs or memory snapshots — they drift

If a value in this doc no longer matches the CSS, the test in
`src/design-system-contracts.test.ts` will fail CI. Fix the doc and
the token in the same commit so they stay in lockstep.
