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

## Voice + signal vocabulary

The semantic layer maps colors to maritime/comms metaphors:

- `--signal-charlie / november / kilo / uniform / victor / lima` — signal flags onto status roles
- `--voice-mayday / pan-pan / securite / hail / roger / wilco / report / over / out` — radio voice procedures onto urgency/status tiers
- `--channel-scope / topic / qualifier / sep` — color the parts of a `topic:scope` channel name

These exist so coordination UI (FleetBar, Guard, Fleet Control Center)
can paint state without inventing ad-hoc palettes. Read
`tokens.semantic.css` for the full mapping.

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
- **Illustration is architectural-blueprint.** Crisp linework, hatching for shading, hand-lettered italic labels. Not painterly cinematic. Canonical reference: `public/img/generated/_brand-reference/style-ref-blueprint.png`.

## When in doubt

1. `cat website-v2/src/styles/tokens.semantic.css` — the source of truth
2. Open the live site in both light and dark and read what's actually there
3. Don't trust historical chat logs or memory snapshots — they drift

If a value in this doc no longer matches the CSS, the test in
`src/design-system-contracts.test.ts` will fail CI. Fix the doc and
the token in the same commit so they stay in lockstep.
