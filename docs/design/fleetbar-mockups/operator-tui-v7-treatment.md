# Operator TUI v7 — Treatment (The Whole Console)

**The buildable spec behind [`operator-tui-v7.html`](./operator-tui-v7.html).** v7
builds directly on **v6** (the rebuilt real-IDE Editor) and **v5** (the converged
visual language + live daemon binding) and answers one ask: *the operator needs to
SEE the whole console, not just the chat loop.* It does **not** clobber v1–v6 — it
ADDs two files (`operator-tui-v7.html`, this treatment). Palette, type scale, the
sound engine, the bubble register, and the live-data layer are all inherited from
[`operator-tui-v5`](./operator-tui-v5.html) / v6; this doc covers only what is
**new in v7**.

## The seam: the mode-rail grows from 5 to 9

v6's rail was the chat-loop spine — **Sphere · Swarm · Control · Heat · Editor**.
v7 keeps those five untouched and appends **four machine-surfaces** so the rail now
maps the *entire* autonomy loop, not just the conversation about it:

```
SPHERE    home / parsimony — talk to the buddy, retreat here (⌥0)        ← v6
SWARM     watch agents work — avatar bright, agent panes dimmed          ← v6
CONTROL   look over an agent's shoulder — its pd attention feed          ← v6
HEAT      where is the swarm — pheromone viz Modes A/C/D                 ← v6
EDITOR    the code itself — IDE + filetree + Mode-B AST heat + claims    ← v6
ROADMAP   the work pile the loop is grinding through (now/next/later)    ← NEW
SPEND     what the fleet is spending — cost vs cap, tokens, counters     ← NEW
DISPATCH  the tube→spawner chain made visible — fire & watch a sortie    ← NEW
HARBOR    who's moored — agents + you + Alice, the maritime payoff       ← NEW
```

`⌥0`/`Esc` still retreats to the Sphere from anywhere; `1`–`9` jump straight to a
mode; the swoosh (`cubic-bezier(.16,1,.3,1)`, **≤340ms**, `swoosh-in` keyframe,
hard-frozen under `prefers-reduced-motion`) plays on every switch. The avatar stays
home and nudges high-level — the four new surfaces are **opt-in detail**, exactly
like v4's parsimony contract. The rail is `overflow-y:auto` so it never clips on a
short viewport.

## The craft bar, carried to four new surfaces

Every new view wears the same **editorial console head** — an `eyebrow` kicker, an
`h1`, and a right-aligned **mono provenance line** naming the real route(s). That
one component is what makes nine views read as *one hand*:

| Surface | Eyebrow | Provenance line (live) |
|---|---|---|
| Roadmap | THE WORK PILE | `GET /roadmap/items → 25 now · live` |
| Spend | WHAT THE FLEET IS SPENDING | `GET /metrics · /usage/summary · /sorties (live)` |
| Dispatch | (inline section heads) | `GET /fleet/models · /sorties · /sorties/:id/logs (live)` |
| Harbor | WHO'S MOORED AT THIS HARBOR | `GET /harbors · /sessions (live)` |

Inherited discipline, unbroken: **one restrained accent per surface** (Roadmap's
*now* column gets the teal spine; Spend's gauge + hero stat is teal; Dispatch's fire
button + selection is brand-blue; Harbor's berths are blue with the teal *you*
berth). **Mayday-red stays reserved** for the human-gate (the top BLOCK card) and
two honest failure echoes — Spend's `errors` counter and Harbor's `brig` row.
Asymmetric Swiss tension (380px compose rail vs fluid feed in Dispatch; 1.5fr/1fr in
Heat/Spend/Harbor). 3:1 Gestalt rhythm between groups. Departure-mono pixel accents
for counts, glyphs, and the anchor mark; Geist for everything that reads as voice.

## What's LIVE-bound vs VISION-labeled

The whole point of v5's data layer was *honest, not Potemkin*. v7 extends
`hydrate()` with `hydrateV7()`: on a reachable daemon (`:9876`, same-origin or
`?pd=`), every new surface upgrades to **real data**; offline it shows representative
sample data and the status pill says `offline · sample`. **Live values are untrusted
input** (agent ids, file paths, goals, DM/inbox content) and pass through `esc()`
before they touch `innerHTML` — the same rule v5/v6 established (and the same
build-time follow-up applies: a real ratatui/Tauri surface renders via `textContent`
/ a sanitizer).

| Surface | Live binding (verified against the running daemon) | Vision-labeled (clearly, never faked) |
|---|---|---|
| **Roadmap** | `GET /roadmap/items?status=now\|next\|later` → real slugs, `summaryMd`, `dependencies[0]`, `promotedByAgentId` ("on it"). **25 now-items** rendered live. | — (fully live) |
| **Spend** | `GET /metrics` (port assignments, race/validation/error/message counters, uptime) + `GET /usage/summary` (costUsd, totalTokens, `costByScope` per-agent bars) + `GET /sorties` (done/failed counts). Honest: usage is `$0.00` because `/usage/events` is empty on this daemon — the strip says so rather than inventing spend. | — (fully live; cost shows real zero) |
| **Dispatch** | `GET /fleet/models` → the **real backend catalog with `launchable` / `readinessStatus` / `readinessNextStep`** (only `cloudflare`+`openai` are *ready*; the other 9 are *needs_setup*). `GET /sorties` → 12 real sorties with real `status` (mostly `blocked`/`failed`). `GET /sorties/:id/logs` → the real event stream, including the literal `sortie:blocked` event *"No launchable backend (no configured attempt is setup-ready)"*. | The **Fire sortie** button itself is a mockup affordance (it toasts the `POST /sorties` shape) — it does not actually spawn, and it stays **blocked** unless you pick a `launchable` backend AND set a `$` budget ceiling. **No fake green launch.** |
| **Harbor** | `GET /harbors` → the real fleet harbor (the one with the most members) + `GET /sessions` → live agent sessions become moorings (your own `tui-v7-multiview` coordination session shows up — dogfooded). | **Multi-device presence** (macbook/desktop/phone as one identity), **join-by-anchor** address, and the **credits / brig** ledger are the V4 anchor-protocol payoff from the `federated-harbor` whitepaper — each carries a calm `VISION` pill, never dressed as shipped. "Alice" is labeled `multi-device · vision`. |

### The Dispatch honesty contract (the one that matters most)

The brief was explicit: *do not depict a fake green launch.* The whole Dispatch view
is engineered around the truth that **spawn is mostly not launch-ready on this
machine**:

- Backends sort `ready`-first, each with a colored **lamp** (Charlie-green = ready,
  warning-amber = needs_setup) and a `READY` / `NEEDS SETUP` tag. Selecting a
  needs_setup backend reveals its real `readinessNextStep` ("Install Claude Code…
  run `claude setup-token`").
- The **fire button is `blocked` by construction** — it only arms (`armed`, blue)
  when the selected backend is `launchable` **and** a budget ceiling > 0 is set. The
  sub-line explains *why* it's blocked, every time.
- The sortie list shows the daemon's real distribution (**4 blocked · 13 failed · 8
  completed**), and the streamed log surfaces the actual blocking event verbatim.

This is the tube→spawner chain shown as it really is: a budget-gated, readiness-gated
pipeline where most attempts can't launch yet.

## The single bounded fleet-harbor pixel zone

Per the converged language, Swiss restraint governs everywhere **except one bounded
pixel zone**. In v7 that zone is the Harbor **berths** — 30px Departure-mono sprite
tiles (a glyph per mooring + a presence dot), tinted by kind (teal *you*, ochre
*human*, blue *agent*). It is deliberately small, gridded, and contained inside the
moorings card; it gives the maritime payoff its texture without letting pixel-art
leak into the rest of the console.

## Skills folded in (the design lenses)

| Skill | What it changed in v7 |
|---|---|
| **swiss-modern-website-design** | the shared `con-head` (eyebrow + h1 + mono provenance), strict grids, one accent per surface, restraint on 4 new views |
| **gestalt-web-design** | figure–ground (the *now* column / the hero stat / the fire button is the one figure per surface); 3:1 proximity rhythm; the berths as a contained similarity group |
| **adhd-design-expert** | the rail stays the whole map (object permanence); `1`–`9` is one transition, not nested nav; Dispatch's blocked-button copy is compassionate + actionable, never shaming |
| **human-gate-designer** | the Dispatch readiness gate as a *present–decide–route* surface — what's ready, one decision (pick + budget + fire), routed into the log |
| **beautiful-cli-design** | honest state above all (the `$0.00` spend, the `blocked`/`failed` sorties, the `needs_setup` lamps) — every blocked state names its next action |
| **desktop-window-layout-architect** | single primary window with panes; Dispatch's compose rail + log feed as a master/detail; Harbor's moorings + side cards |
| **design-critic** | type hierarchy ≥1.25 carried; no trend pileup — the new views reuse the existing token + component vocabulary rather than inventing chrome |

## Honesty + accessibility ledger

- **Real PD shapes:** Roadmap = `RoadmapItem` (`slug`/`summaryMd`/`dependencies`/
  `promotedByAgentId`); Spend = `/metrics` + `UsageSummary.totals`/`costByScope`;
  Dispatch backends = the real `/fleet/models` catalog (`launchable`/`readinessStatus`/
  `readinessNextStep`); sorties = the real `Sortie` rows + `/sorties/:id/logs` events;
  Harbor = real `/harbors` + `/sessions`. Anchor/credits/multi-device are VISION.
- **WCAG AAA** carried from v5 (same canon `tokens.semantic.css` names — no
  cinnabar/kelp/canary), verified in **both themes** (light + dark screenshots).
- **14px floor** on all prose/body/caption; the only sub-14px text is the rail's
  uppercase+700+tracked micro-labels and the same eyebrow class v6 already shipped.
- **Reduced-motion** safe (the `swoosh-in` entrance, the gauge fill, the BLOCK halo,
  the orb breathing all freeze; sound is motion-coupled and hard-mutes under
  `reduce`). Opt-in sound. Swoosh ≤340ms (< the 400ms budget).
- **No emojis as icons** — maritime/geometric glyphs (anchor, triangle, diamond,
  squares) and the bounded berth pixel sprites only.
- **Validation:** headless Chromium against the **live daemon** (`?pd=:9876`), all
  nine views, light + dark + 200% zoom, **zero console errors**, fonts load, live
  pill reads `live · :9876`. Confirmed live counts: 25 roadmap now-items, 11
  backends with real readiness, 12 sorties, 4 moorings.

## What I'd blind-test next

(1) *Cold operator opens Dispatch — do they understand spawn can't launch yet, and
what to do about it, in <5s?* (2) *On Spend, does `$0.00` read as "honestly nothing
spent" or "broken"?* (3) *On Harbor, does the VISION pill clearly separate the
shipped roster from the anchor-protocol future?* (4) *Does the 9-mode rail still feel
parsimonious, or did we cross from "the whole map" into "too many doors"?*
