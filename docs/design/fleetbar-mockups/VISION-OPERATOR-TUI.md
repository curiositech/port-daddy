# Vision — The Operator TUI (single pane of glass for Port Daddy)

> Operator's words, captured verbatim-in-spirit. This is the north star for the
> TUI track. Build toward this; the mockups in this folder are the starting
> vocabulary, not the ceiling.

## The one-sentence vision

**The PD TUI is the ONLY place I use Port Daddy.** I talk to one agent — my
**operator-avatar** — and it dispenses all the others (sorties, agents, fleets).

## What it must do

### One agent, many dispatched
I engage a single operator-avatar agent. It launches as many agents as it needs
to make the roadmap hum in parallel. **It can just roll**: create worktrees, open
PRs through agents, adversarially test them, review, respond to CI, make tests +
CI/CD green, merge, prune worktrees, and mark the roadmap item done — autonomously.
(This is ADR-0043's roadmap as load-bearing truth + the tube→spawner bridge +
`pd attest`'s loud-fail gating, all driven from one seat.)

### Multiplex into the work (tmux-y, but more intuitive + colorful)
- The screen **splits**. I multiplex into any agent to watch its work live.
- Keyboard **tab / shift / move** semantics to toggle between panes or spawn new
  sub-windows. Faster and more intuitive than tmux; colorful, legible, labeled by
  **role not PID** (cf. roadmap item `crew-screen-roles-not-pids`).
- Panes for: **main**, any **worktree**, any agent's transcript, the filetree.

### A filetree that's rich and beautiful — and alive
- Lines and **words** of files are **heat-coded** with recent agent attention and
  other **pheromone traits** (who touched this, how hot, suggestions pending,
  conflict risk). This is the substrate/pheromone vocabulary made visible.
- **Rolled-up tree visualizations** of directories I can explore (zoom from repo →
  dir → file → line, heat aggregating up the tree).

### I steer by dropping signals on the code
- Looking at code, I can **drop my own pheromones / tuples / notes** to instruct
  my operator-avatar or guide the working agents — annotate a function, a region,
  a file, and the agents see it.

### The HiTL surface is unmistakable
- A **beautiful, colorful top-of-app area** for human-in-the-loop — approvals,
  questions, blocks — that I can never miss.
- A live **roadmap list** (the `now` pile from `roadmap_items`).
- A view of **what my current agents are doing** and **what the background fleet
  is doing**.

## How it must FEEL (non-negotiable)

> "FAST SO FAST … buttery … SWWWWOOOSH … satisfying … COLORFUL BUT SO BEAUTIFULLY
> LEGIBLE."

- **Instant.** Input→paint with no perceptible lag. Mouse AND keyboard, both
  first-class. Animations that ease, never stutter.
- **Tactile.** Motion + (optional) **sound** on transitions, pane swooshes, agent
  state changes — satisfying, never noisy. Respect a mute/`NO_SOUND` and reduced-motion.
- **Colorful but legible.** Saturated, characterful palette — and never at the
  cost of contrast. Maritime/neobrutalist DNA (ADR-0010); WCAG-AA contrast held
  (the existing QC rounds already enforce this — keep the bar).

## Typography (operator asked for a perfect open/libre font)

From the `typography-expert` skill (which explicitly retires Söhne/Inter/Geist):

- **Primary mono — Commit Mono (OFL):** engineered for code legibility, neutral
  but warm, free + self-hostable. The body/code/UI workhorse of the TUI.
- **Chrome (labels, eyebrows, HiTL headers) — IBM Plex Sans (OFL):** shares a
  skeleton with Plex Mono → guaranteed harmony if we ever mix; libre superfamily.
- **Accent / retro flourish — Departure Mono (OFL):** pixel-mono for the swoosh /
  splash / "tech-y" moments only — used sparingly.
- Floor: **14px-equivalent legibility**; let the terminal scale — never pre-render
  at the smallest grid. Eyebrows may go smaller only if uppercase + bold + tracked.

## Build constraints (inherit from AGENT-HANDOFF.md)

Honest not Potemkin (read real daemon state). No emojis as icons. Scratch only
under `~/coding/tmp`. Coordinate via PD. Don't touch daemon `lib/`/`routes/`/
`server.ts` except the `pd-tui` crate. Keep the QC blind-test discipline.

## Suggested phasing (→ ADR-0046 Implementation Matrix → roadmap)

0. Layout shell + pane model (split/tab/move, role-labeled) reading live `/spawn`,
   `/health`, `/roadmap/items`.
1. The HiTL top bar + roadmap `now` list + "my agents" + "background fleet" panels.
2. Rich filetree with pheromone heat-coding (lines/words) + rolled-up dir viz.
3. Operator signal-drop (pheromone/tuple/note on a region) → agents consume it.
4. Operator-avatar autonomy loop (roadmap → worktree → PR-via-agent → adversarial
   test → review → CI → merge → prune → mark done), gated by `pd attest` + HiTL.
5. Feel pass: motion curves, swoosh transitions, sound design, font integration,
   60fps budget, reduced-motion/mute.
6. Blind-test QC round (personas) + accessibility audit; iterate.
