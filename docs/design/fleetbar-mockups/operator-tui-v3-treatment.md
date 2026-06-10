# Operator TUI v3 — Design Treatment (Swiss-Modern, light-first, AAA)

**The buildable spec behind [`operator-tui-v3.html`](./operator-tui-v3.html).**
v3 supersedes v1 (file-browser, rejected) and v2 (right interactions, but
dark-only and read as too sparse / brutalist). It brings back the gorgeous,
blind-tested **FleetBar** quality and maritime soul, re-rendered in the
**International Typographic Style** per the in-repo
[`.claude/skills/swiss-modern-website-design`](../../../.claude/skills/swiss-modern-website-design/SKILL.md),
on the **portdaddy.dev warm-paper design system**, at **WCAG AAA**.

It implements [ADR-0046](../../adr/0046-operator-tui.md) and the
[VISION](./VISION-OPERATOR-TUI.md), and folds in the substrate/pheromone/
multiplayer research from [INGEST](./INGEST-substrate-pheromone-multiplayer.md).

---

## What changed from v2 → v3 (operator feedback, captured live)

| Operator said | v3 response |
|---|---|
| "SO dark. Teal on black? Blech. Think of the portdaddy.dev website system." | **Light-first.** Default `:root` is the warm-paper canon LIGHT theme (cobalt-on-paper ITS look). Dark is a toggle (`t`), not the only mode. |
| "I would love for you to think about the tab resizing/creation/splitting dynamics … how we start talking to agents … talking to the avatar and seeing its history … editing metadata for our ships." | A full **dynamics layer**: dispatch-an-agent → tab+pane+vessel **materialise**; `⌥⏎` split, `⌥w` stow, `z` zoom, draggable **gutter** + `⌥[`/`⌥]` nudge; an **avatar dispatch-history** drawer (`h`); ship-metadata edited in the harbor card with a **pennant-raise acknowledgment**. |
| "Do some sound engineering … show me how things open and close … realistic flows … end to end." | A designed **Web Audio engine** (8 semantic cues, ship's-bridge register) wired to real state changes; a working **end-to-end dispatch flow**. |
| "I want WCAG AAA, my eyes wanna be on pillows." | **Every text/surface pair is AAA (≥7:1) in both themes.** Verified in `.scratch/contrast.py`. |
| `/typography-expert go find AWESOME FONTS` | Adopted the **Geist superfamily** — the typography-expert skill's explicit DP-1 pick for "Swiss-modern, technical, sharp." |

It also honors the swiss skill's failure modes — **no gray mush** (AAA contrast, a
decisive accent), **no accent sprawl** (one accent, mayday reserved), **no soft-UI
drift** (hairlines, flat surfaces, no glass/blur except the harbor reveal scrim),
**grid is visible not just declared** — and the **beautiful-cli-design** skill's
rules (semantic colors not rainbow, light+dark verified, honest state, every error
is a next-action surface — the HiTL gate *is* the next action).

---

## How swiss-modern + the FleetBar skeleton combine

The FleetBar gave the blind-tested **structure and soul** to preserve; the swiss
skill gave the **visual language** to render it in. v3 keeps the skeleton and
shifts the language (the skill lists neobrutalism as "Not For", so this is a
deliberate *shift*, not a copy):

| FleetBar skeleton (kept) | Neobrutalist language (dropped) | Swiss-modern language (v3) |
|---|---|---|
| HiTL gate as an **editable contract** you approve/deny | 5px slabs, hard offset shadows, chunky frames | A single decisive band, **1px hairline rules**, flat fills |
| **Session shield / attestation** ("name the pain in the user's words") | loud borders everywhere | typographic hierarchy carries weight; rules separate, not boxes |
| **Role-not-PID** labelling, maritime flag glyphs | ICS-flag color riot | one accent + semantic state; flags as small monochrome marks |
| Maritime voice (mayday / pan-pan / sécurité) | red used for emphasis broadly | **mayday-red reserved** for the human gate only |
| The HiTL "needs you" surface you can never miss | screaming chrome | pre-attentive by being the **only** saturated-red fill on a calm page |

The harbor is the one place the FleetBar's playfulness survives intact (see below).

---

## Type system — the Geist superfamily

Per `typography-expert` **DP-1** (display) and **DP-3** (mono), the 2026 pick for a
*Swiss-modern, technical, sharp* voice is **Geist** (Vercel, OFL): geometric, sharp
terminals, ships Sans + Mono + Pixel, designed-to-pair. This beats a
Space-Grotesk-+-Commit-Mono mashup on cohesion and satisfies the skill's pairing
rules (one family, different cuts — no "competition, not hierarchy" violation).

> The VISION doc claimed the skill "retired Geist." That is stale — the current
> skill *recommends* Geist for exactly this voice (DP-1 table, row 1). v3 follows
> the live skill, not the outdated summary. (House style: first mention of a PD
> abstraction → bold + repo path; here the abstraction is the skill itself.)

| Family | Role | Why |
|---|---|---|
| **Geist** (Sans) | chrome — hero argument, role labels, eyebrows, section titles, HiTL tags, keycaps text | the swiss hierarchy engine: weight + size + case + tracking contrast, sharp terminals |
| **Geist Mono** | body — chat, code, transcripts, tree, pheromone bars | `slashed-zero` + `tabular-nums` **on by default** (skill hard rule), **no ligatures** (`font-variant-ligatures:none`) so `->`/`>=` never ligate into box-drawing breaks |
| **Departure Mono** (OFL) | pixel accent — fleet-harbor vessel labels, keycaps, the `⚓` mast | the one playful pixel voice, used *only* in the expressive zone |

Type scale (typography leads; floor honored everywhere):

| `rem` / px | Use | Rule |
|---|---|---|
| `clamp(1.7rem,2.6vw,2.25rem)` | hero argument (the one display line) | the visual engine of the screen |
| `1.25rem` / 20px | satellite-panel `h3` | section titles |
| `0.9375rem` / **15px** | body, chat, code, tree | ≥14px floor ✓ |
| `0.875rem` / **14px** | captions, agent sub-labels, status segs | ≥14px floor ✓ |
| `0.8125rem` / **13px** | eyebrows, role tags, keycaps | uppercase + **700** + `letter-spacing ≥.06em` only — the eyebrow exception ✓ |

Viewport allows zoom to 5×; audited at 200% (everything reflows, nothing clips).

---

## Grid & composition

A strict, visible grid — the swiss skill's "grid must be visible in the results,
not merely declared":

- **App shell**: 3 rows — HiTL bar / workbench / status bar. Workbench is 3 cols —
  **roadmap rail (248px) · multiplex (fluid) · context rail (320px)**. Fixed rail
  widths give hard alignment edges; the mux flexes.
- **Multiplex**: a flex split — **avatar column** + a draggable **gutter** + an
  **agent column** (stacked panes). The split defaults 58/42; the operator drags
  the gutter or nudges with `⌥[`/`⌥]`. Animated via the swoosh curve.
- **Spacing cadence**: 4 / 8 / 12 / 16 / 24 / 32 / 48px — micro spacing tight,
  section spacing generous, outer margins slightly more generous (swiss).
- **Hairlines everywhere**: 1px `--border-subtle` rules separate modules. No card
  chrome, no shadows (`--shadow-*` are `none` in canon), radii ≤10px.

---

## The ONE accent + the reserved mayday

- **One controlled accent: brand blue.** Light `--brand-primary` `#003fb8`
  (7.55:1 AAA); dark `#7db4ff` (8.79:1 AAA). It marks the active-pane ring, tab
  underline, focus, heat ramp, and primary affordances.
- **The avatar's seat is teal** (`--brand-accent`) — a *second, restricted*
  semantic accent so "the seat I talk to" reads differently from "an agent I
  dropped into," with no legend. Light `#004a42` (8.82:1 AAA), dark `#8fd0a7`.
- **Mayday-red is reserved.** Solid `--status-error` / `--voice-mayday` fills
  **only** the HiTL "needs a human" surfaces (the BLOCK card + the `N await you`
  counter). Nothing else in the app fills with it, so it wins the pre-attentive
  race on a calm page. Agent "blocked" state uses red only as a 1px outline / 8px
  dot — never a slab. The pheromone heat ramp is **blue**, never red, so heat can
  never steal mayday's color. This is the urgency-primacy law from
  `pheromone-vocabulary-v1.md` §4.1 made visual.

---

## Canon color table — every UI color → a `tokens.semantic.css` var

Every value resolves to a variable that literally exists in
[`website-v2/src/styles/tokens.semantic.css`](../../../website-v2/src/styles/tokens.semantic.css).
**No invented names** (no cinnabar/kelp/canary). Both themes inlined in the mockup
under the same names. Ratios computed in `.scratch/contrast.py`.
**AAA (≥7:1) held on every text/surface pair in both themes.**

### LIGHT (default — warm paper)

| Semantic var | Value | On | Ratio | Grade |
|---|---|---|---|---|
| `--text-primary` | `#121212` | `--surface-base` `#f2eee6` | 16.19:1 | AAA |
| `--text-secondary` | `#403b34` | `--surface-base` | 9.59:1 | AAA |
| `--text-muted` | `#47423a` | `--surface-base` | 8.61:1 | AAA |
| `--brand-primary` (accent) | `#003fb8` | `--surface-base` | 7.55:1 | AAA |
| `--brand-accent` (avatar) | `#004a42` | `--surface-base` | 8.82:1 | AAA |
| `--success-ink` | `#15522a` | `--surface-base` | 7.99:1 | AAA |
| `--status-warning-on-tint` (text) | `#5b3900` | `--surface-base` | 8.94:1 | AAA |
| `--error-ink` | `#8c1d1d` | `--surface-base` | 7.86:1 | AAA |
| `--code-text` | `#edf1f9` | `--code-bg` `#12161f` | 15.99:1 | AAA |
| `--code-flag` | `#8dc4ff` | `--code-bg` | 9.89:1 | AAA |
| `--code-line-number` | `#a0a8ba` | `--code-bg` | 7.59:1 | AAA |
| DIMMED secondary chat (`--dim` 0.92) | blended | `--surface-base` | 7.70:1 | AAA |
| **MAYDAY slab** text (`--mayday-slab-fg` white) | `#ffffff` | `--mayday-slab` `#a51f1f` | 7.46:1 | AAA |

### DARK (toggle)

| Semantic var | Value | On | Ratio | Grade |
|---|---|---|---|---|
| `--text-primary` | `#f5f3ed` | `--surface-base` `#101216` | 16.90:1 | AAA |
| `--text-secondary` | `#d3cec2` | `--surface-base` | 11.94:1 | AAA |
| `--text-muted` | `#b3ad9f` | `--surface-raised` `#181c22` | 7.65:1 | AAA |
| `--brand-primary` (accent) | `#7db4ff` | `--surface-base` | 8.79:1 | AAA |
| `--brand-accent` (avatar) | `#8fd0a7` | `--surface-base` | 10.49:1 | AAA |
| `--status-success` | `#66d28a` | `--surface-base` | 9.95:1 | AAA |
| `--status-warning` | `#f2be51` | `--surface-base` | 10.94:1 | AAA |
| `--code-line-number` | `#a0a8ba` | `--code-bg` `#0b0d11` | 8.15:1 | AAA |
| DIMMED secondary chat (`--dim` 0.80) | blended | `--surface-base` | 7.91:1 | AAA |
| **MAYDAY slab** text (`--mayday-slab-fg` ink) | `#121212` | `--status-error` `#ff7d7d` | 7.57:1 | AAA |

> **Notes on the AAA work.** (1) Colored *text* uses the AAA-grade darker members
> of each maritime family (`--brand-accent` → the on-tint `#004a42`; new
> `--success-ink`/`--error-ink`; warnings-as-text use `--status-warning-on-tint`).
> The brighter `--status-*` are kept for **dots / borders / vessel fills**, which
> are graphical objects (WCAG 1.4.11, AA-large) not body text. (2) The light
> mayday slab is darkened to `#a51f1f` so white text on it is AAA; in dark the red
> is already light, so ink text clears AAA. (3) "Dimmed-but-legible" recession is
> carried by a **surface tint + the focus ring**, with opacity tuned per theme so
> dimmed *body text* still clears AAA (opacity alone would have dropped it).

### Pheromone heat ramp — single-hue blue (demoted, inline)

Heat is not a rainbow tree; inside an agent's satellite/code card a single-hue blue
intensity ramp shows *where an agent is working*. Blue, never red — heat must never
borrow the mayday color (the v2 reservation, kept).

---

## The multiplex model — every piece, and how it lands

| Vision requirement | Where it is in v3 | Interaction |
|---|---|---|
| Talk to **one avatar**; it dispatches the rest | leftmost, widest pane, teal ring, focused on load | type → it echoes you, replies, **dispatches** |
| **Fork a session seamlessly** | avatar Control satellite + `⌥f` | writes a new `.portdaddy/current.json`; avatar carries the roadmap into the fork |
| **Hop around agent chats** with keyboard | tab strip + `⌥N` + `Tab` cycle | swoosh to the pane, ring + tab underline follow |
| MAIN chat **full readability**; others **dimmed but legible** | focused pane opacity 1; others `--dim` (AAA still) + tint | hover brightens; focus restores fully |
| Per agent: **pheromone / pd attention / control / tools / files** | the **satellite tab row** inside each pane head | `pheromone` reads the urgency-primacy bars; `attention` renders `pd attention --peek --json`; `files` lists read(▸)/edit(◆) |
| **Ad-hoc chat groups** | the `group` tab + `+ group` | starting one publishes on `harbor:port-daddy:role:<role>` (channel) + inboxes matching agents |
| **Beautiful file tree**, agents **read/edit in live time** | right rail, "File tree" | ▸ = reading, ◆ = editing (pulses), heat dots aggregate up the tree |
| **Operator notes** — overall / in-spot / per-file | tree footer note input + spray HUD "Leave a note" | `feedback.drop(source:'human')` + `file:annotation` tuple, stamped `git_sha_at_annotation`, expiry-contract ("until PR #231 merges") |

### Dynamics — the choreography (the operator's explicit ask)

1. **Start talking to an agent.** Two paths. (a) Type to the **avatar**: it echoes
   your message, replies with its dispatch decision (the real `tube→spawner`
   router, #225), and a **new tab + pane materialise** in the agent column
   (swoosh-in, 420ms), a **new vessel sails into the harbor**, and the dispatch is
   **logged to avatar history** — then focus glides to the new pane. (b) Hover an
   idle vessel and **Open full chat** to multiplex straight in.
2. **Split / create.** `⌥⏎` brings the focused agent's chat into the mosaic; a
   stowed agent re-materialises the same way. The agent column stacks panes; the
   gutter splits avatar vs agents.
3. **Resize.** Drag the **gutter** (fat hit area, turns brand-blue on grab) or
   nudge with `⌥[` / `⌥]`. During drag the transition is suppressed for 1:1
   tracking; on release it eases.
4. **Collapse / stow.** `⌥w` or the tab `✕` swooshes a pane out and hides its tab —
   **the agent keeps running** (a stow, not a kill); the toast says so and points
   you to the harbor/`⌥N` to reopen.
5. **Zoom.** `z` collapses the agent column so the focused pane fills the center;
   `z` again restores the mosaic.
6. **Avatar history.** `h` (or the pane-head `log` button) slides in the
   **dispatch-history drawer** — a scrubbable editorial log of *what the avatar
   did and why* (each row: time · action · the operator ask or signal that caused
   it). New dispatches and metadata edits prepend to it live.
7. **Edit ship metadata.** Hover a vessel → the card shows **editable** telos /
   sitrep / triggers / side-effects + the transcript. **Save** persists the edits
   (→ `agent_inbox` + tuple), the vessel **raises a signal pennant** and pulses
   (the acknowledgment), and the edit is logged to history.

---

## The fleet-harbor — the single playful zone, kept within swiss restraint

The harbor is the one contained expressive zone, so it can pop without becoming
accent-sprawl. Discipline that keeps it swiss-legal:

- **It is bounded.** It lives in one toggle of the right rail (File tree ⇄ Fleet
  harbor). Everywhere else stays calm and exact; the harbor is a *figure* on the
  page, not the ground.
- **Vessels are CSS pixel-sprites, not emoji.** Each tugboat (worker) and battle
  cruiser (heavy agent) is drawn from `box-shadow` pixel grids in
  `--vessel-trim` + a state color — honoring "no emojis as icons." Color =
  state: green active, amber burning-cash, grey idle, blue cruiser.
- **Waves are dithered CSS gradient bands** (`image-rendering:pixelated`), tinted
  per theme (paper-toned shallows in light, deep maritime in dark) — no images.
- **The reveal is the depth.** Hover a vessel → a card with its whole story,
  **displayed and editable** (telos/sitrep/triggers/side-effects/transcript). The
  blur on the card scrim is the *only* glass in the app, and it's inside the
  expressive zone — not soft-UI drift in the chrome.
- **The avatar nudges you up.** The hero argument ("One avatar. A whole fleet.")
  and the harbor legend ("hover a vessel … stay high-level") remind the operator
  they *can* go this granular but should mostly let the avatar conduct.

---

## Sound — a designed ship's-bridge palette (opt-in)

Not a generic beep per event — an **engineered cue per semantic state change**,
each with an intentional pitch register, envelope, and timbre, all <220ms, pitched
into a ship's-bridge register. Off by default (`m` toggles; honors `NO_SOUND` in a
real build). A *humming* fleet is silent — cues confirm **state changes only**.

| Cue | Event | Sound design |
|---|---|---|
| `dispatch` | avatar spawns an agent / fork | rising perfect-5th G4→D5, triangle — "a vessel sets out" |
| `open` | pane / drawer / HUD materialises | short band-passed noise **whoosh up** |
| `close` | pane stows / drawer closes | noise **whoosh down** |
| `spray` | signal dropped on code / note | felt-tip **`tk`** — high square blip, very short |
| `approve` | HiTL approve | **ship's bell** — two struck sine partials, warm |
| `block` | (would be) block arrival | **low gong** 110Hz — darkest but *quiet*, lands as gravity not panic |
| `tick` | tab / theme / focus / gutter nudge | tiny UI click |
| `ack` | ship metadata saved (pennant) | confirming minor-3rd up C5→E♭5 |

**Reduced motion = hard mute** for sound too — because these cues are
motion-coupled (they accompany swooshes); `prefers-reduced-motion: reduce` silences
them and the engine never starts an `AudioContext`.

---

## Motion — buttery, swooshy, never stuttery (≤400ms)

| Curve | cubic-bezier | Duration | Used on |
|---|---|---|---|
| **swoosh** | `(.16,1,.3,1)` | 380–420ms | pane materialise/stow, drawer slide, split resize, toast, HUD |
| **snap** | `(.34,1.56,.64,1)` | 160ms | focus ring, hover-lift, button press, vessel hover |
| **ease** | `(.4,0,.2,1)` | 200–300ms | tab color, row bg, opacity, gutter color |

Looping cues (all freeze gracefully under reduced-motion): HiTL BLOCK card `beat`
(1.4s mayday halo — the one thing built to grab you), tab live-dot `blip` (1.8s),
filetree edit-glyph `pulse` (1.2s), composer cursor.

> **Reduced motion.** Everything animated is wrapped in
> `@media (prefers-reduced-motion: no-preference)`; under `reduce` the mayday halo
> freezes on its high-contrast frame, panes jump instead of swoosh, sound is muted.
> **Focus and state are always conveyed by color + border + position**, never
> motion alone.

---

## Honesty ledger (honest-not-Potemkin)

- **Real PD concepts / shapes.** The roadmap `now` list is the **real
  `roadmap_items`** filtered `status:now` — the actual ADR-0046 phase slugs pulled
  from `GET /roadmap/items?status=now` on the live daemon (v3.17.0). Agents are
  `/spawn` rows labelled by **role**. The dispatch flow names the real
  `tube→spawner` router (#225). The spray HUD writes the real vocabulary
  (`pheromones.spray('files', path, 'attention:human')`, `feedback.drop`,
  `file:annotation`, `git_sha_at_annotation`, expiry-contracts). The attention
  satellite renders the **built, shipped** `pd attention --peek --json` shape
  (`cli/commands/attention.ts`, PR #231). Heat is the real `/pheromone/files`
  shape. The HiTL gate is the FleetBar editable-contract.
- **Representative data.** Specific PR numbers, transcript lines, and dollar
  amounts are illustrative; in the shipped `pd tui` each panel binds to a live
  route.
- **Still research-only** (don't over-promise): per-kind half-life decay, the
  `pheromone_events` lineage ledger, the clustered/normalized `/pheromone/heat-tree`
  endpoint, AST/symbol-level overlay. v3 shows these as *design intent*, grounded
  on the live `/pheromone/files` predecessor.
- **Mutating interactions in the mockup** (so the *feel* is real): pane
  focus/split/stow/zoom, gutter resize, the dispatch flow (materialises a real
  tab/pane/vessel + history row), HiTL resolve + counter, the spray HUD (drops a
  `✎` pin + toast), operator notes, ship-metadata save (pennant ack), theme +
  sound toggles. Nothing is a dead button.

---

## Runtime target (where this ships)

Per the VISION + `beautiful-cli-design` routing: the chrome ships as a **ratatui**
Rust TUI (durable stateful interface → full TUI framework justified); the
fleet-harbor's pixel/motion zone is a candidate for a **Tauri** webview embedded in
the same shell. The canon tokens are mirrored to Rust in ADR-0046 phase-4
(`adr-0046-phase-4-canonical-token-mirror`) so the TUI, this web mock, and FleetBar
re-derive identical colors from `tokens.semantic.css`. NO_COLOR / narrow-width /
pipe fallbacks and cursor cleanup are runtime-lane work for the build.

---

## What I'd blind-test next

Run the 15-persona panel on three questions: (1) *fleet idle and silent, can a cold
operator find the one thing that needs them in <3s?* — v3's structural answer is
mayday-red exists only on the HiTL bar. (2) *Does the dispatch flow read as "I
talked, it acted" without a tutorial?* (3) *Does the avatar-vs-agent ring color
(teal vs blue) read as "the seat I talk to" vs "an agent I dropped into" without a
legend?* And re-confirm AAA after any palette nudge — the contrast script is the
gate.
