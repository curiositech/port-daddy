# Operator TUI v4 — Treatment (Parsimony, Pheromone Viz, Control Plane)

**The buildable spec behind [`operator-tui-v4.html`](./operator-tui-v4.html).** v4
builds directly on v3 (swiss-modern, light-first, Geist, WCAG AAA, sound engine)
and answers the operator's five v4 asks. It does **not** clobber v1/v2/v3 — it ADDs
two files. Palette + type + sound are inherited from
[`operator-tui-v3-treatment.md`](./operator-tui-v3-treatment.md); this doc covers
only what is **new in v4**.

## Coordination note (pow-wow)

A live agent — `port-daddy:ia-refactor-design`
(`session-design-ia-refactor-operator-loop-diagnose-mute-p-…`) — is refactoring
the **operator-loop information architecture into six phases** in
`docs/design/2026-06-03-ia-refactor-operator-loop.md`. v4 is the **visual mockup**
of that loop and is deliberately scoped to NOT touch that doc. I published a
pow-wow on channel `port-daddy:design:operator-loop` offering to re-label the v4
mode-rail to their phase slugs once they publish them. **The v4 mode-rail
(Sphere / Swarm / Control / Heat / Editor) is the IA seam** — if the six-phase IA
names the surfaces differently, only the rail labels + this table change; the
views are stable.

> **CLI-mute finding, confirmed.** The same agent found the homebrew `pd` CLI
> (3.17.0) emits 0 bytes and exits 1 (crashes pre-output), which is why guard/notes
> via the CLI fail. The daemon on `:9876` is healthy. All v4-session coordination
> (notes, the pow-wow message) went through **daemon `curl`** (`POST /sessions/:id/notes`,
> `POST /msg/publish`), not the broken binary. Flagging for a separate CLI-rebuild thread.

---

## The five asks → how v4 answers them

### 1. PARSIMONY + an unmissable avatar "retreat sphere"

The organizing principle of v4 is **the Avatar Sphere is home.** It is the default
view and `⌥0` (and `Esc`) retreats to it from anywhere. The sphere is a calm,
near-empty room:

- a **breathing avatar orb** (teal, a standing presence dot) — your buddy, visually
  the single largest, warmest element on the page;
- a **one-line plain-language digest** ("Everything's handled. 5 agents working,
  0 need you — except one merge waiting on your yes");
- the **avatar's own message** in its teal bubble;
- **one ask box** ("Talk to your buddy — or just press Enter to let it keep going");
- **four peek-chips** (the only counts shown) that jump to the dense surfaces.

Everything dense (panes, control plane, heat tree, editor) is **opt-in**, reachable
from the left **mode-rail** but never in your face. This is **cognitive-load
parsimony**, grounded in the `adhd-design-expert` skill:

| ADHD/cognitive principle (skill) | v4 application |
|---|---|
| **Working memory 3–5 items** | sphere shows ~4 peek-chips + 1 digest + 1 ask; mode-rail is exactly 5 |
| **Object permanence** (everything visible, no hidden menus) | the mode-rail keeps every surface visible-but-collapsed; nothing is buried |
| **Task initiation** (obvious first step) | one ask box, and "just press Enter to let it keep going" — zero-friction default |
| **Context switching** (minimal transitions) | mode swap, not nested navigation; `⌥0` is a constant anchor |
| **Rejection sensitivity** (compassionate, non-shaming copy) | "Everything's handled… Nothing's on fire" — the buddy reassures, never nags |

This also satisfies the `gestalt-web-design` **figure–ground** rule — *only ONE
primary figure per screen area; dim the competing elements*: the sphere has exactly
one figure (the avatar); the Swarm view dims secondary agent panes (`--dim`, AAA-safe).

### 2. My words ≠ the avatar's words ≠ the agents' words (typographic + chromatic register)

A deliberate three-register split so you always know **who** is talking, applying
the gestalt **similarity / break-similarity** rule (similar register = same kind of
voice; break it for a different voice):

| Voice | Family | Color | Shape / position | Why |
|---|---|---|---|---|
| **You** | Geist **Sans** | ink on warm paper (`--you-bg`) | right-anchored, square bottom-right corner | your words read as *human authorship* |
| **Avatar** (your buddy) | Geist **Sans, medium, larger (1rem)** | **teal** (`--brand-accent`), soft teal bubble, a `◈` presence mark | left, unmissable, a *standing presence* | the one voice you can always retreat to — visually warmest, never recedes |
| **Agents** | Geist **MONO** | cooler, recessed (`--surface-raised`, left rule) | smaller (14px), machine register | clearly *the swarm*, not your buddy — easy to tune out |

The avatar is **unmissable by construction**: it is the only teal voice, the only
breathing orb, the largest bubble, and it owns the home view. The agents are mono +
recessed so the swarm's chatter never competes with your buddy for attention.

### 3. IDE-style editor + filetree (its own view)

The **Editor** mode is a real three-pane IDE:

- **Live filetree** — `▸` an agent is reading, `◆` an agent is editing (pulses),
  `✎` an operator note; a per-file **heat bar** colored by the file's *dominant*
  pheromone kind. You watch the swarm read and edit in live time.
- **Syntax-highlighted code** with the **pheromone AST/symbol overlay (viz Mode B)**:
  per-line heat bands, a colored **gutter-heat strip**, **region-claim rails**
  (blue = helmsman, green = lookout) with agent attribution, and the operator's
  **inline annotation** rendered in context (`✎ you: keep peek read-only · @a4f1b9 ·
  expires when PR #231 merges`).
- **Symbol rail** (a `desktop-window-layout-architect` *trailing inspector* that
  tracks the selection): each function with its heat bar, region claims, and an
  explicit **"⚠ overlap risk · L46 contested"** plus `subscribe()` flagged
  `experience:failed · 1 revert`.

### 4. Pheromone visualization — the full five modes

Built straight from `.scratch/pheromone-visualization-research.md`. The **Heat**
view renders Modes A, C, D; the **Editor** view renders Mode B; the **Control
Plane** renders Mode E.

| Mode | What | Where in v4 |
|---|---|---|
| **A — heat-tree treemap** | files/dirs as tiles, dominant-kind hue, `max` headline per dir | Heat view, left |
| **B — AST/symbol overlay** | per-function heat + region claims within a file | Editor view, symbol rail + code bands |
| **C — time sparkline** | "which way the fever moves" — rising/cooling/re-flared, hue shifts along length | Heat view, right (60-min strip) |
| **D — glance tile** | one-screen summary + the **top-kind disambiguator** | Heat view, right (Glance) |
| **E — enriched `pd sniff`** | per-kind `value · rank · trend · advice` (not a bare scalar) | Control Plane, "Pheromones it reads" |

**The composition law (the research's core finding), enforced visually:**

- **Dominant kind drives the hue; other kinds are corner GLYPHS** — because
  *color × shape* is the most *separable* channel pair, and >2 channels degrades to
  "mud" (per the channel-separability prior art). Never RGB-per-kind.
- **Reserved always-visible set** gets guaranteed glyph real estate regardless of
  dominance: `attention:human-blocked` (◆ cobalt), `quality:test-failing` (⚠ ochre),
  `cost:burning` ($ red-ink). The legend binds each glyph.
- **Red is reserved for failure-class kinds only** (`experience:failed`,
  `claim:contested`) — the Datadog rule. `hot:editing` is **ochre** ("busy"), so the
  operator is never trained to ignore red. The Glance "Top kind: hot:editing (3 of
  3) — **busy, not on fire**" line is the explicit busy-vs-burning disambiguator.
- Headline aggregation is **`max` per directory** ("there's a fire in this room"
  beats averaging it away), stated in the heat-head so a collapsed tile never lies.

### 5. Agent control plane — what `pd attention` actually sends an agent

The **Control Plane** view renders the **real `lib/attention.ts` schema**
(`AttentionSummary` / `AttentionItem`) for a *selectable* agent (helmsman / lookout
/ spider), with the honest provenance line
`GET /attention?agentId=…&peek=1 → AttentionSummary`. Four cards:

- **Inbox · DMs** — `AttentionItem`s from the personal inbox, with FIPA
  performatives (INFORM / REQUEST), `from` attribution, and `receivedAt`.
- **Subscribed channels** — the agent's `subscriptions[]`, scope:topic + new-count.
- **Pheromones it reads** — the **Mode-E** enriched sniff: each kind with
  `value · rank (low/med/high, the swarm-relative percentile) · trend (▲▶▼)`, plus
  the deterministic **`advice →`** line that turns a scalar into an action.
- **Suggestions** — the **ADR-0039 suggestibility layer**, rendered as accept /
  decline / mute cards with `confidence`. All four kinds modeled:
  `group-chat-proposal` (≥2 agents, cosine > 0.85 + overlapping claims),
  `prior-art-doc` (nearest-neighbor against ADR/skill/episodic indices),
  `claim-overlap-headsup` (promoted soft-claim), `salvage-candidate`. Accept/decline/
  mute map to the real verbs (`pd suggestion accept|decline`, `pd attention --mute
  kind:<kind> --until +Nh`) — and a declined suggestion primes the 4h cooldown.

This is the operator looking **over the agent's shoulder** at its own attention
feed — the coordination layer made inspectable.

---

## Skills folded in (the design lenses)

| Skill | What it changed in v4 |
|---|---|
| **swiss-modern-website-design** | the structural law — typography-first, strict grid, one accent, restraint (inherited from v3) |
| **gestalt-web-design** | figure–ground (one primary figure per area; dim competitors → the sphere + dimmed agent panes); break-similarity for the avatar's distinct register; 3:1 proximity spacing between groups |
| **adhd-design-expert** | the whole **parsimony / retreat-sphere** model: ≤5 items in working memory, object permanence, compassionate copy, obvious first step, minimal transitions |
| **human-gate-designer** | the HiTL BLOCK card as a *present–decide–route* gate: what to show (cost/files/enforcement), one decision (Approve/Deny), routed back into the avatar's loop |
| **desktop-window-layout-architect** | single primary window with panes (not floating windows); the Control Plane + symbol rail as *trailing inspectors* that track the selection; chrome density discipline |
| **design-critic** | the **hierarchy ≥1.25 type-ratio** rule — v4 scale is 2.0/1.5/1.2/0.9375 (ratios 1.33 · 1.25 · 1.28, all clear); avoided trend-overdose (no glass + bento + brutalism pileup) |
| **beautiful-cli-design** | semantic colors not rainbow; light+dark verified; honest state; every error a next-action surface (the BLOCK gate) — and the ratatui runtime routing |
| **app-sound-design** / v3 engine | the designed ship's-bridge cues; the new **`home`** cue is a *descending* settle tone (you came home), distinct from `open` |

---

## Information architecture — the mode-rail as the loop

Parsimony at the IA level: the operator never sees more than one surface at a time,
and the rail is the whole map. Each surface owns one job in the operator loop:

```
SPHERE   home / parsimony — talk to the buddy, read the digest, retreat here (⌥0)
SWARM    watch agents work — avatar pane bright, agent panes dimmed-but-legible
CONTROL  look over an agent's shoulder — its pd attention feed (inbox/channels/sniff/suggestions)
HEAT     where is the swarm — pheromone viz Modes A/C/D
EDITOR   the code itself — IDE + filetree + Mode B AST heat + claims + your notes
```

This maps onto whatever six-phase IA the `ia-refactor-design` agent lands; the rail
labels are the only coupling point (see Coordination note).

---

## Honesty + accessibility ledger

- **Real PD shapes:** Control Plane = the real `AttentionSummary`/`AttentionItem`
  (`lib/attention.ts`); suggestions = the real ADR-0039 kinds + verbs; sniff =
  Mode-E `value/rank/trend/advice`; heat = `/pheromone/files` dominant-kind shape;
  the BLOCK gate is the FleetBar editable-contract. The pheromone counts/heat in the
  mockup are representative; in the shipped TUI each binds to a live route.
- **WCAG AAA** carried from v3 (same canon tokens, both themes verified there).
  Type hierarchy ≥1.25 between levels. 14px floor; eyebrows 13px uppercase+700+tracked.
- **Reduced-motion** safe (the orb's breathing, the edit-glyph pulse, the BLOCK halo
  all freeze; sound is motion-coupled and hard-mutes under `reduce`). Opt-in sound.
- **Validation:** headless Chromium, all five views + dark theme, **zero console
  errors**, fonts load.
- **Build-time follow-up (noted, not a mockup defect):** the mockup uses `innerHTML`
  with author-controlled static literals (the one user-input path escapes `<`). When
  this becomes a real ratatui/Tauri surface, render via `textContent` / safe DOM /
  a sanitizer for any agent- or operator-supplied content (DMs, notes, suggestions)
  — agent output is untrusted input.

## What I'd blind-test next

(1) *Cold operator opens the app — do they understand the sphere is home and the
detail is opt-in, without a tutorial?* (2) *Can they tell their words from the
avatar's from an agent's at a 1-second glance?* (3) *On the Heat view, can they tell
"busy" from "on fire" in <3s?* (4) *On the Control Plane, does "this is what the
agent sees" land, or does it read as "this is what I see"?*
