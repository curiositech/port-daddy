# Operator TUI v2 — Design Treatment (corrected)

**A conversation multiplexer, not a file browser.** This is the buildable spec
behind [`operator-tui-v2.html`](./operator-tui-v2.html). It supersedes
[`operator-tui-treatment.md`](./operator-tui-treatment.md) (kept for diff). The
spec it implements is [ADR-0046](../../adr/0046-operator-tui.md).

## Why v2 exists — what v1 got wrong

v1 was rejected by the operator, verbatim:

> "That file browser sucks. I don't want to hop around my vibe repo with that.
> Where's the multiplexing between different agents' chats? Or my ability to
> spray pheromones, or talk to my avatar?"

Two failures, both fixed here:

1. **It led with a filetree.** v1 made a heat-coded repo explorer a co-equal
   left-column citizen and the most-discussed surface in its treatment (§2 was
   entirely "pheromone heat → filetree"). The operator does not want to navigate
   their repo. v2 **deletes the standalone file browser entirely** and demotes
   code+heat to an *on-demand context card surfaced inline inside an agent's
   chat* (Surface 5), only when an agent touches code worth showing.

2. **It was built on a rotted, forked palette.** v1's tokens came from
   `design/tokens/primitives.json` with invented names — *cinnabar, kelp, canary,
   mustard, sandstone, ebony* — that even mis-named the brand (it called
   canary-yellow the brand color; **canon brand is blue, `#003fb8`/`#7db4ff`**).
   v2 reads **only** [`website-v2/src/styles/tokens.semantic.css`](../../../website-v2/src/styles/tokens.semantic.css)
   and uses the maritime *semantic* names. No invented color names appear
   anywhere in the mockup or this document.

## The corrected priority order (ADR-0046 §Decision)

The screen is built around **conversations and steering**, in this order:

| # | Surface | Where it lives in the mockup |
|---|---------|------------------------------|
| 1 | **Avatar conversation** — the hero seat | leftmost, widest pane (`1.35fr`), focused on load with a teal (`--brand-accent`) ring. You talk to your operator-avatar; it dispatches everyone. |
| 2 | **Agent-chat multiplexer** | two more panes (`1fr` each) holding **live conversations** with `helmsman` and `caulker`; a fourth role (`spider`) is tabbed. Tabs + panes are labeled by **ROLE, not PID**. `⌥1-4` / `Tab` move focus; the active pane carries a `--brand-primary` ring. |
| 3 | **Pheromone spray** — first-class verb | `s` from any pane opens the **Spray HUD**: drop *Look here* / *This is wrong* / *Prioritize this* / *Leave a note* on the focused target. Confirms with a toast and drops a visible `✎ you:` pin on the line. Stamped at sha, revocable. |
| 4 | **HiTL top bar + strips** | top bar (reserved mayday-red); left rail = roadmap `now` pile; right rail = my-agents + background-fleet + cost gauge. |
| 5 | **Code + heat = on-demand context** | a `.codecard` rendered **inside** a chat bubble when an agent shows code, with a single-hue per-line heat ramp. **Never** a navigation mode. |

### How the hero reads — the spray + multiplex grammar

- The **three conversation panes occupy the entire center column**; the very
  first thing the eye lands on after the HiTL bar is *chat bubbles between you
  and your avatar and agents* — never a file list.
- Panes are **conversations, role-labeled**: `Avatar · conducting 3`,
  `Helmsman · PR #231`, `Caulker · gating`. The role flag glyph (Kilo `▌▐`,
  Charlie `▀▄`, Victor `▞▚`, avatar `◈`) and the role name carry identity; no PID
  is ever shown.
- **Spray is in your face from every composer:** each focused pane's prompt bar
  ends with `spray a signal  s`, and `s` is in the status bar. The HUD names the
  exact tuple it will write (`pheromones.spray(path, 'attention:human')`,
  `feedback.drop`, `file:annotation`) — steering is a verb with a real shape, not
  decoration.
- **Demotion is visible:** there is no filetree column. Code appears only as a
  small inline card an agent produced, captioned `conflict · 2 actors · ⌥2 to
  open`. You read code *because an agent surfaced it in conversation*, not
  because you went browsing.

## Color system — canon only

Every color resolves to a variable that **literally exists in
`tokens.semantic.css`**. Dark-theme values are inlined in the mockup under the
same names. The mockup is dark-themed; the table lists the dark value used and
its WCAG ratio against the surface it sits on. Computed in `.scratch_contrast.py`
(this branch). **AA floor (4.5:1) held everywhere; almost all clear AAA.**

### Text on surfaces

| Semantic variable | Dark value | On | Ratio | Grade |
|---|---|---|---|---|
| `--text-primary` | `#f5f3ed` | `--surface-base` `#101216` | 16.90:1 | AAA |
| `--text-secondary` | `#d3cec2` | `--surface-base` | 11.94:1 | AAA |
| `--text-muted` (lowest muted) | `#a59f93` | `--surface-base` | 7.12:1 | AAA |
| `--text-muted` | `#a59f93` | `--surface-sunken` `#0b0d11` | 7.39:1 | AAA |
| `--code-text` | `#f5f3ed` | `--code-bg` `#0b0d11` | 17.53:1 | AAA |
| `--code-flag` | `#8dc4ff` | `--code-bg` | 10.62:1 | AAA |
| `--code-comment` | `#c7d0e5` | `--code-bg` | 12.58:1 | AAA |
| `--code-line-number` | `#7e8ba3` | `--code-bg` | 5.66:1 | AA |

### Brand, accent, status (as text / glyphs on the page)

| Semantic variable | Dark value | Role in TUI | Ratio on `--surface-base` | Grade |
|---|---|---|---|---|
| `--brand-primary` | `#7db4ff` | active-pane ring, securité, tab underline, focus | 8.79:1 | AAA |
| `--brand-accent` | `#8fd0a7` | the **avatar** (its ring, prompt, spray accent) | 10.49:1 | AAA |
| `--status-success` / `--signal-charlie` | `#66d28a` | running agents, "active" dots | 9.95:1 | AAA |
| `--status-warning` / `--voice-pan-pan` / `--signal-uniform` | `#f2be51` | warnings, APPROVE card edge | 10.94:1 | AAA |
| `--status-info` / `--signal-kilo` | `#7db4ff` | thinking, QUESTION card edge, helmsman | 8.79:1 | AAA |
| `--status-error` / `--signal-november` | `#ff7d7d` | blocked **state dots / tag outlines only** (never a slab) | 7.57:1 | AAA |

### The reserved mayday slab — text *on* `--status-error`

`--status-error` / `--voice-mayday` (`#ff7d7d` dark) is used as a **solid fill
ONLY on the HiTL "needs a human" surfaces** (the BLOCK card and the `N await
you` counter). Nothing else in the system fills with it, so it always wins the
pre-attentive race. Because the dark-theme red is *light*, the text on it is
`--text-inverse`, not white:

| Slab | Text | Dark value pair | Ratio | Grade | Token role |
|---|---|---|---|---|---|
| `--status-error` BLOCK card | `--text-inverse` | `#121212` on `#ff7d7d` | 7.57:1 | AAA | HiTL block / mayday |
| `--status-error` `N await you` | `--text-inverse` | `#121212` on `#ff7d7d` | 7.57:1 | AAA | HiTL counter |
| BLOCK tag chip | `--status-error` on `--text-inverse` chip | `#ff7d7d` on `#121212` | 7.57:1 | AAA | tag inversion |

> **The reservation, on the record.** Solid `--status-error` is the *only*
> mayday-red fill in the TUI. Agent state uses it only as a **1px outline / 8px
> dot** (`statetag.block`, `dot.november`) — never as a filled slab — so a
> blocked agent reads as "blocked" without competing with the HiTL bar for the
> same solid red. This directly answers v1's open QC question (§8: "if
> heat-cinnabar and HiTL-cinnabar compete, reserve solid red for needs-a-human").
> v2 enforces it: the demoted heat ramp is **blue** (`--brand-primary`), not red,
> so heat can never steal mayday's color.

### HiTL slabs that are *not* mayday (lower gravity)

| Slab edge | Text | Pair | Ratio | Grade | Token role |
|---|---|---|---|---|---|
| `--status-warning` APPROVE chip | `--text-inverse` | `#121212` on `#f2be51` | 10.94:1 | AAA | awaiting-human |
| `--status-info` QUESTION chip | `--text-inverse` | `#121212` on `#7db4ff` | 8.78:1 | AAA | query-ref |
| `--brand-primary` mast | `--brand-primary-foreground` `#121212` | `#121212` on `#7db4ff` | 8.78:1 | AAA | brand |

### Pheromone heat ramp — single-hue blue, demoted to inline context

Heat is **not** a rainbow tree anymore. Inside an agent's inline code card, a
single-hue intensity ramp on `--brand-primary` shows *where an agent is working*
— that's all. The hottest line (`h3`, 34% blue wash over `--code-bg`) still holds
`--code-text` at **8.65:1 (AAA)**.

| Step | Wash over `--code-bg` | Meaning |
|---|---|---|
| `h1` | `rgba(125,180,255,.10)` | touched |
| `h2` | `rgba(125,180,255,.20)` | active |
| `h3` | `rgba(125,180,255,.34)` | hottest — an agent is here now |

Blue, not red, on purpose: heat must never borrow the mayday color.

## Type scale

Three OFL families (Söhne/Inter/Geist retired per the brief). Only **three**
declared sizes; floor honored everywhere.

| Family | Role |
|---|---|
| **Commit Mono** (OFL) | all body, chat, code, transcripts |
| **IBM Plex Sans** (OFL) | chrome — eyebrows, role labels, HiTL tags, keybinds |
| **Departure Mono** (OFL) | pixel accent — flag glyphs, the `⚓` mast/anchor, the spray-option numerals, the "HELM" overlay title; never prose |

| `rem` / px | Use | Rule |
|---|---|---|
| `0.9375rem` / **15px** | body, chat, code, tree | ≥14px floor ✓ |
| `0.875rem` / **14px** | captions, agent sub-labels, status segs | ≥14px floor ✓ |
| `0.8125rem` / **13px** | eyebrows, role tags, keybind chips | uppercase + **700** + `letter-spacing ≥.08em` only — the eyebrow exception ✓ |

`font-variant-ligatures:none` + `tabular-nums` forced so `->`/`>=` never ligate
into box-drawing breaks and numeric columns align. Viewport allows zoom to 5×.

## Motion — buttery, swooshy, never stuttery

| Curve | cubic-bezier | Duration | Used on |
|---|---|---|---|
| **swoosh** | `(.16,1,.3,1)` | 380ms | toast in/out, pane focus glide |
| **snap** | `(.34,1.56,.64,1)` | 160ms | pane focus ring, card hover-lift |
| **ease** | `(.4,0,.2,1)` | 220ms | tab color, row bg |

Looping cues (all freeze gracefully under reduced-motion): HiTL BLOCK card `beat`
(1.1s mayday halo — the one thing built to grab you), the `needs-human` left rail
`rail` pulse (1.6s), tab live-dot `blip` (1.8s), composer cursor `blink` (1s).
**All swoosh gestures sit under the 400ms ceiling.**

> **Reduced motion.** Everything is wrapped in
> `@media (prefers-reduced-motion:no-preference)`. With `reduce`: the mayday rail
> *freezes on its high-contrast frame* (stays full-red), the BLOCK card keeps a
> static red glow, the toast still appears but jumps. Focus is always conveyed by
> **color + border + position**, never motion alone.

## Sound (optional, `m` to mute, honors `NO_SOUND`)

Off by default in CI/headless, opt-in, every cue <220ms, pitched into a
ship's-bridge register. Cues confirm *state changes* only — a running fleet is
silent. HiTL **block** is the *quietest-but-darkest* tone, so mayday lands as
gravity, not panic. **pheromone spray (`s`)** gets a tiny felt-tip `tk` — tactile
confirmation you marked the code. `m` toggles the `sound on/muted` status seg.

## Interaction model — multiplex + steer

| Key | Action |
|---|---|
| `⌥1-4` | Focus a pane — avatar or any agent chat (swoosh to it) |
| `Tab` | Cycle pane focus forward |
| `s` | **Spray a steering signal** on the focused target → HUD |
| `1-4` / `⏎` (in HUD) | Pick + spray a signal; `Esc` cancels |
| `⏎` | Send to the focused conversation |
| `a` | Approve the top HiTL card |
| `m` | Mute / unmute sound |
| `?` | HELM keyboard reference; `Esc` closes |

Mouse is equally first-class: click a tab/agent-row to focus, click a HiTL card
to resolve it (counter decrements; at 0 the bar goes calm-grey "all clear"), `s`
to spray. **Every interaction mutates real state** — focus, the HiTL counter, the
sprayed `✎` pin on line 41. Nothing is a dead button.

## Honesty ledger

- **Real PD concepts / shapes:** the `now` list is `roadmap_items` filtered
  `status:now` (the real ADR-0046 phase slugs); agents are `/spawn` rows labeled
  by role; the spray HUD writes the real tuple/route vocabulary
  (`pheromones.spray`, `feedback.drop`, `file:annotation`, stamped with
  `git_sha_at_annotation`, revocable — PR #231 substrate); the cost gauge is
  spend-vs-cap; HiTL cards are `awaiting-human`/`query-ref`/`pan-pan` states.
- **Representative data:** the specific PR numbers, transcript lines, and dollar
  amounts are illustrative. In the shipped `pd tui` each panel binds to a live
  route (`GET /roadmap/items`, `/spawn`, `/health`, `GET /attention`,
  `POST /pheromone/spray`).
- **Mutating interactions in the mockup:** pane focus, HiTL resolve + counter,
  the spray HUD (drops a real `✎` pin + toast). Wired so the *feel* is real.

## What I'd blind-test next

Run the 15-persona panel on one question: *fleet idle and silent, can a cold
operator find the single thing that needs them in <3s?* v2's answer is structural
— mayday-red exists **only** on the HiTL bar, and heat is blue — so the red can't
be stolen by the work surface. Confirm the panel agrees the BLOCK card wins the
race, and that the avatar-vs-agent ring colors (teal vs blue) read as "the seat I
talk to" vs "an agent I dropped into" without a legend.
