# Operator TUI — Design Treatment

**The single pane of glass.** One operator-avatar agent. It dispenses all the
others. This document is the buildable spec behind
[`operator-tui-mockup.html`](./operator-tui-mockup.html): the color system, type
scale, motion curves, sound design, the pane/multiplex interaction model, and
how pheromone heat maps to color.

North star: [`VISION-OPERATOR-TUI.md`](./VISION-OPERATOR-TUI.md). DNA:
[ADR-0010 Maritime Design Language](../../adr/0010-maritime-design-language.md).
Quality bar inherited from [`tui-mocks.QC.md`](../tui-mocks.QC.md) (Round 2:
**48/50**, WCAG-AA contrast floor held). All hex values are read from
[`design/tokens/primitives.json`](../../../design/tokens/primitives.json) and the
semantic mapping from
[`design/tokens/themes/dark.json`](../../../design/tokens/themes/dark.json) —
nothing in this file invents a color; it only names the verified ones.

---

## 0 · Layout — five zones, one seat

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ⚓ MAST │   HiTL FEED  (approvals · questions · blocks)      │ N need you │  ← top bar (unmissable)
├────────┴──────────────────────────────────┬──────────────────┴───────────┤
│ ROADMAP · NOW   │      PANE MULTIPLEXER     │  MY AGENTS                   │
│ (the now pile)  │  tabs: role-labeled       │  (helmsman/caulker/spider)   │
├─────────────────┤  ┌──────────┬───────────┐ ├──────────────────────────────┤
│ FILETREE · HEAT │  │ avatar   │ transcript│ │  BACKGROUND FLEET            │
│ (pheromone)     │  │ chat ◈   │ helmsman  │ │  (gardener/qa/cartographer…) │
│  rolled-up dirs │  │ focused  │  ▌▐       │ │  ──────────────────────────  │
│  line+word heat │  └──────────┴───────────┘ │  cost gauge $9.40 / $25      │
├─────────────────┴───────────────────────────┴──────────────────────────────┤
│ ⚓ Port Daddy │ daemon ● │ agents │ now │ keys │        PHEROMONE HEAT ▮▮▮▮▮│  ← status + legend
└─────────────────────────────────────────────────────────────────────────┘
```

The grid is `auto / 1fr / auto` rows; the body is `264px / 1fr / 296px` columns.
Everything reads against the warm-ebony page (`#1E1B18`) with a faint sky-blue
chart-grid wash (`rgba(127,196,255,.025)`, 28px cells) — the "deep water plotted
on a chart" cue from ADR-0010 §Dashboard Aesthetic, dialed to nearly subliminal
so it never fights the data.

---

## 1 · Color system

All values verified WCAG 2.1 against the dark-theme page (`#1E1B18`). Computed in
`.scratch/contrast.py` (this branch); every text pair clears **AA**, most clear
**AAA**. The one deliberately-tight pair is documented below.

### Core surfaces

| Token | Hex | Role |
|---|---|---|
| `bg-page` ebony | `#1E1B18` | the canvas — warm, not pure black |
| `bg-surface` ebony-soft | `#2B2724` | raised panels, agent rows |
| `bg-elevated` ebony-deep | `#100E0C` | tab strip, status bar, rail heads, offset-shadow pad |
| `bg-inverse` paper | `#F5F5F0` | the operator-avatar's chat bubble (the one bright slab) |
| `bg-brand` canary | `#FFDB33` | mast, active-tab underline, brand status seg |

### Text on page (all on ebony)

| Pair | Ratio | Grade |
|---|---|---|
| paper `#F5F5F0` body | **15.67:1** | AAA |
| fog `#D1D1C7` subtle | **11.15:1** | AAA |
| fog-deep `#B5B5A8` faint (lowest muted permitted) | **8.28:1** | AAA |
| canary `#FFDB33` headings/links | **12.60:1** | AAA |
| kelp `#6DD3A8` term-ok | **9.41:1** | AAA |
| sky `#7FC4FF` term-info | **9.18:1** | AAA |
| cinnabar-lit `#FF9081` term-err | **7.80:1** | AAA |

### HiTL & state surfaces (text *on* the colored slab)

| Slab | Text | Ratio | Grade | State token |
|---|---|---|---|---|
| warning `#F59E0B` — **APPROVE** | ebony | **7.98:1** | AAA | `state-awaiting-human` |
| sky `#7FC4FF` — **QUESTION** | ebony | **9.18:1** | AAA | `perf-query-ref` |
| cinnabar `#CC3D2E` — **BLOCK** | paper-soft `#FFFFFF` | **4.91:1** | AA | `severity-pan-pan` |
| cinnabar `#CC3D2E` — op chat bubble | paper-soft `#FFFFFF` | **4.91:1** | AA | `chat-bubble-user` |
| canary `#FFDB33` — mast / brand | ebony | **12.60:1** | AAA | `bg-brand` |

> **The tightest pair, on the record.** Text on cinnabar is the single AA-floor
> pair in the system. The v4 mockup's QC Round 2 (`tui-mocks.QC.md`, fix #7)
> flagged paper-on-cinnabar at **4.5:1 — no headroom** and recommended lifting to
> `paper-soft #FFFFFF`. **This treatment takes that recommendation:** every
> cinnabar slab (HiTL block card, operator chat bubble) uses `paper-soft`, which
> computes to **4.91:1** — clears AA Normal with ~0.4 of headroom instead of
> sitting exactly on the line. Do not let the cinnabar value drift darker without
> re-checking this pair.

### Maritime ICS flag colors (theme-invariant)

Agents are labeled by **role**, never PID — and each carries an ICS signal-flag
glyph as its avatar (ADR-0010 §Signal Flags). Rendered as pixel micro-glyphs in
the maritime-neobrutalist vocabulary (`▌▐ ▀▄ ▞▚ ◈ ⬗ ◇`), never emoji:

| Role | Flag | Glyph | Color | Meaning |
|---|---|---|---|---|
| Helmsman | Kilo | `▌▐` | navy `#1E3A8A` | ready to communicate (steering the PR) |
| Caulker | Charlie | `▀▄` | canary `#FFDB33` | affirmative (sealing the gating) |
| Spider | Victor | `▞▚` | cinnabar-lit `#FF9081` | require assistance (blocked) |
| Operator-Avatar | (helm) | `◈` | kelp `#6DD3A8` | the one you talk to |
| Gardener | — | `⬗` | purple `#b69cff` | background sweep |

---

## 2 · Pheromone heat → color

This is the most novel surface. The filetree is **alive**: lines, words, files,
and rolled-up directories carry recent agent attention and pheromone traits
(who-touched, how-hot, signal-pending, conflict-risk). Heat is a **6-step ramp**,
cool→hot, chosen so each step's *glyph* foreground clears AA against ebony while
the *wash* behind the row stays a low-alpha tint that never lowers text contrast.

| Step | Wash (row bg, left→right fade) | Glyph fg | Semantic meaning |
|---|---|---|---|
| 0 untouched | transparent | — | no recent attention |
| 1 cold | kelp `rgba(109,211,168,.16)` | kelp `#6DD3A8` | touched, settling |
| 2 cool | sky `rgba(127,196,255,.22)` | sky `#7FC4FF` | recent reads |
| 3 warm | mustard `rgba(237,197,49,.30)` | mustard `#EDC531` | active edits |
| 4 hot | canary `rgba(255,219,51,.46)` | canary `#FFDB33` | one agent hammering |
| 5 blazing | cinnabar `rgba(204,61,46,.55)` | cinnabar-lit `#FF9081` | multi-agent / conflict-adjacent |

**Why this ramp, not a rainbow.** The ramp reuses the system's existing semantic
colors in their *existing* meanings — kelp already means "active/settling," sky
"informational," canary "attention," cinnabar "danger/burning." So heat is not a
new arbitrary scale a user must learn; it is the same color language they already
read in the terminal, *aggregated*. Blazing == cinnabar == "two actors want this
surface" maps directly onto the `state-conflict` token. The legend in the status
bar shows all five glyph swatches cool→hot.

**Line heat** is the left-fading wash on a `.tnode` row (`linear-gradient(90deg,
heat-N, transparent)`) — so the *start* of the line (the filename) gets the
tint, trailing toward the markers, keeping the name itself readable.

**Word heat** (phase 2): inside a focused file pane, individual tokens/spans get
the same wash — `attest.ts:§send` lights warmer than its neighbors. The CSS class
is the same `.h3/.h4/.h5`; it just wraps a `<span>` instead of a row.

**Rolled-up directory heat** is a 4-cell gauge (`.roll`) on the right of each
directory node — the aggregate of child heat, hottest-child-first, so collapsing
a directory still tells you "something in here is on fire" without expanding it.
`lib/` shows `▮▮▮·` (cinnabar/canary/sky/—) because caulker and helmsman are both
inside it; the `⚠` conflict marker sits beside the name.

**Who-touched + signals** ride as bordered pixel badges: `HM` (helmsman, sky),
`CK` (caulker, kelp), `CT` (cartographer, purple), `YOU` (canary). A `✎` in canary
means **you dropped a pheromone/note there** (Vision §"I steer by dropping signals
on the code"). A `⚠` in cinnabar-lit means conflict risk.

---

## 3 · Type scale

Three OFL families, no Söhne/Inter/Geist (per the brief and the
`typography-expert` skill that retires them):

| Family | Role | Where |
|---|---|---|
| **Commit Mono** (OFL) | primary workhorse | all body, code, transcripts, chat, tree |
| **IBM Plex Sans** (OFL) | chrome | eyebrows, role labels, HiTL tags, keybind names |
| **Departure Mono** (OFL) | pixel accent — *sparingly* | flag glyphs, the "Helm" overlay title, the SWWWWOOOSH splash |

Commit Mono and IBM Plex share a humanist-neutral skeleton, so the mono↔sans
transitions at every panel header read as one voice, not two fonts fighting.
Departure Mono is the retro-techy flourish reserved for moments that should feel
*tactile* — flags, the splash, the overlay headline — never for prose.

| Size | rem / px | Use | Rule |
|---|---|---|---|
| body / mono | `0.9375rem` / **15px** | all prose, code, chat, tree, transcript | ≥14px floor ✓ |
| eyebrow | `0.8125rem` / **13px** | section labels, role tags | uppercase + **700** + `letter-spacing .12em` only ✓ |
| header | `1.0625rem` / 17px | rail heads, pane heads | — |
| big | `1.5rem` | mast anchor, overlay title | — |

`font-variant-ligatures: none` + `tabular-nums` are forced inside the TUI so
Commit Mono never collapses `->` / `>=` into ligatures and breaks box-drawing,
and so numeric columns (cost, ctx, timestamps) align. **Floor honored
everywhere:** the smallest declared size is `0.75rem` *only* on the bordered
pixel badges (`.by`, `.st`), which are uppercase + bordered glyph-codes
(`HM`/`RUN`), not prose — the eyebrow exception. Body never drops below 15px;
the viewport meta allows zoom to 5×.

---

## 4 · Motion — buttery, swooshy, never stuttery

Four named curves. Everything is GPU-cheap (transform + opacity + box-shadow).

| Curve | cubic-bezier | Duration | Character | Used on |
|---|---|---|---|---|
| **swoosh** | `(.16, 1, .3, 1)` (expo-out) | **380ms** | the buttery glide | pane resize, focus scroll, HiTL card dismiss, split |
| **snap** | `(.34, 1.56, .64, 1)` (back-out) | **160ms** | the satisfying pop | pane focus ring, card hover-lift, agent-row lift |
| **ease** | `(.4, 0, .2, 1)` (std) | **220ms** | quiet transitions | tab color, row bg, gauge |
| **fly** | linear over swoosh | 380ms | the SWWWWOOOSH | the pixel splash that flies across on spawn/split |

Looping cues (all `≤ 1.8s`, all freeze gracefully under reduced-motion):

- **HiTL block card** `beat` — a 1.1s cinnabar-lit halo pulse. The one thing
  designed to grab your eye. The left rail of the whole top bar also pulses
  (`rail`, 1.6s) so the HiTL zone is unmissable in peripheral vision.
- **Tab live-dot** `blip` — 1.8s opacity breathing; kelp=running, sky=thinking,
  cinnabar=blocked.
- **Cursor** `blink` — 1s steps, the one true terminal heartbeat.

**Spawn/split choreography:** new pane does `popin` (scale .96→1 + 8px rise over
swoosh) while the SWWWWOOOSH pixel-text flies left→right and a new agent row
`slidein`s from the right rail. Three synchronized 380ms gestures = the "a crew
just launched" feeling. Total budget per gesture **< 400ms** (QC §"No false
promises" ceiling is 600ms — we sit well under).

> **Reduced motion.** Everything above is wrapped in
> `@media (prefers-reduced-motion: no-preference)`. With **reduce**: pulses
> *freeze on their high-contrast frame* (the block card stays haloed, the HiTL
> rail stays at full opacity), the swoosh splash does not fly, pane focus
> *jumps* (border + lift still change — focus is conveyed by color + position,
> never by motion alone), and `scrollIntoView` uses `behavior:'auto'`. No
> information is lost when motion is off. Verified headless with
> `reduced_motion='reduce'` (see `.scratch/rm.py`).

---

## 5 · Sound design (optional, `m` to mute, honors `NO_SOUND`)

Sound is **off by default in CI/headless**, opt-in, and every cue is short
(< 220ms), low-velocity, and pitched into the maritime register — think a
ship's-bridge console, not a video game. The `♪` glyph in the top-right shows
sound is live; `m` toggles `.muted-sound`.

| Event | Cue | Character |
|---|---|---|
| HiTL **approve** lands | `chime` | single warm marimba note, C5 — "received" |
| HiTL **question** arrives | `ping` | soft two-note rising sonar blip — "your turn" |
| HiTL **block / mayday** | `klaxon` | one short low brass swell, *quiet but grave* — never alarm-fatigue loud |
| **pane spawn / split** | `swoosh` | airy filtered-noise sweep matched to the 380ms fly |
| **agent → done** | `tick` | dry woodblock — the satisfying "merged" |
| **pheromone drop** (`g`) | `dab` | tiny felt-tip *tk* — tactile confirmation you marked the code |
| **cost crosses 75% cap** | `creak` | low hull-stress groan — "watch the burn" |

Design principle: cues confirm state *changes*, never steady state. A running
fleet is **silent**. You only hear the deltas — and the gravest delta (mayday) is
the *quietest-but-darkest* tone, so it lands as gravity, not panic.

---

## 6 · Pane / multiplex interaction model

tmux-shaped, but role-first and colorful. Panes are labeled by **ROLE not PID**
(roadmap item `crew-screen-roles-not-pids`): the tab reads `HELMSMAN ·2 PR #214`,
never `pts/3 · pid 88421`.

**Pane kinds:** `avatar` (the operator-avatar chat — your one conversation),
`transcript` (any dispatched agent's live log), `worktree` (a checked-out
worktree's file view), `filetree` (the heat tree, poppable into the center).

**Focus** is shown three ways at once (so it survives color-blindness *and*
reduced-motion): a **canary border**, an **inset + outer glow ring**, and a
**z-lift**. The active **tab** carries a 3px canary filled-edge underline
(`▓▓▓▓`, the neobrutalist signature from QC fix #4 — not a default ratatui tab).

### Keybindings

| Key | Action |
|---|---|
| `⌥` + `1…5` | Focus pane by number (swoosh to it) |
| `Tab` / `⇧Tab` | Cycle pane focus forward / back |
| `⌥` + `n` | New pane — spawn an agent / multiplex into one |
| `⌥` + `\` | Split the focused pane |
| `⏎` | Talk to the operator-avatar (when its pane is focused) |
| `g` (or `⏎` on a tree node) | **Drop a pheromone / note** on the cursor's region — adds the `✎` marker, writes a tuple the crews read |
| `a` | Approve the top HiTL card |
| `m` | Mute / unmute sound |
| `?` | Keyboard reference overlay ("Helm") |
| `Esc` | Dismiss overlay |

Mouse is equally first-class: click a tab to focus, click a HiTL card to resolve
it (it lifts off and the counter decrements — honest, not decorative), click a
tree node + `g` to drop a signal. Every interaction in the mockup mutates real
state (counter, markers, focus) — nothing is a dead button.

---

## 7 · Honesty ledger (what's real vs. representative)

Per the handoff's "honest, not Potemkin" rule:

- **Real PD concepts, real shapes:** the `now` pile is `roadmap_items` filtered
  `status: now`; agents are `/spawn` rows labeled by identity; the cost gauge is
  spend-vs-cap; pheromone heat + who-touched + conflict are the substrate/tuple
  vocabulary; HiTL cards are `awaiting-human` / `query-ref` / `pan-pan` states.
- **Representative data:** the specific PRs, dollar amounts, and transcript lines
  are illustrative. In the shipped `pd tui`, every panel binds to a live route
  (`GET /roadmap/items`, `/spawn`, `/health`, `/msg/:channel`) — the mockup's job
  is to fix the *visual grammar*, not fake the backend.
- **Interactions that mutate state in the mockup:** HiTL resolve (counter
  decrements), pheromone drop (`g` toggles the marker), pane focus (`⌥1-5`/`Tab`).
  These are wired so the *feel* is real.

---

## 8 · What I'd blind-test next

Run the 15-persona panel from
[`iteration-synthesis.html`](./iteration-synthesis.html) on **one question
only**: *with the fleet idle and silent, can a cold operator find the single
thing that needs them within 3 seconds?* — i.e., does the pulsing-cinnabar HiTL
rail + "1 awaits you" status seg actually win the pre-attentive race against the
colorful-but-busy heat tree, or does the heat tree's blazing cinnabar rows steal
the same red the HiTL needs to own. If heat-cinnabar and HiTL-cinnabar compete,
demote tree-blazing to a *patterned* cinnabar (hatched) and reserve solid
cinnabar exclusively for "needs a human."
