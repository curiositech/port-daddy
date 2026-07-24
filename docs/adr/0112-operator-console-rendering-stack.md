# 0112. Operator Console Rendering Stack — gpui shell + Vello viz surfaces

## Status

Proposed — 2026-06-19. Author: Erich (operator, single-person operation).

Resolves the rendering-stack fork that has been implicit since the v11 spec and is
now blocking the v12 "living harbor" vision. Establishes that the operator console
is a **gpui shell** for structure/widgets/text, and that the bespoke-vector
visualizations (timeline, ghost filetree, merge-as-light, biofield) render through
**Vello/wgpu surfaces** the shell hosts — not by forcing one stack to do everything.
Cites `core/pd-timeline-proto` as the proof spike.

## Context

### Two stacks, one window — the unresolved fork

`core/pd-console` (the operator console, `feat/console-tmux-multiplexer`) is built on
**gpui** (*Zed's GPU UI framework; crates.io 0.2.2, Metal on macOS*). gpui is excellent
for the multiplexer: a pane tree with splits/tabs/zoom, hover-reactive widgets, shaped
text, the eventual rope-buffer editor. What gpui's widget model **cannot** do well is
arbitrary compute-rasterized vector art — smooth cubic-bezier causal threads, a scrubbed
playhead, anti-aliased path fills at 60fps. gpui has *no fluent transform* (no scale /
translate); "motion" there is faked with box-shadow + opacity (see ADR-noted v12 motion slice).

The v11 spec (`docs/design/fleetbar-mockups/operator-console-v11-SPEC.md`) picked gpui and
deferred the question. But the v12 synthesis
(`docs/design/fleetbar-mockups/operator-console-v12-synthesis.html`) is full of viz that
is *exactly* bespoke vector rendering: the **ghost filetree** (parallel-universe worktree
planes), **merge-as-light** (a voyage easing into `main` on a bezier → flash → settle),
the **biofield** (fireflies over the filetree), and a **voyage timeline**. None of those
are gpui widgets.

### The proof spike already exists

`core/pd-timeline-proto` (Track-B R&D, 2026-06-19) is a **standalone macOS window** that
renders a Voyage Timeline with **Vello** (*Linebender's compute-based GPU path renderer*) +
**Parley** (*Linebender shaping/layout over HarfRust*) on **wgpu** (lowers to Metal on macOS;
confirmed `backend: Metal, Apple M4 Max` at runtime). It reads **live** daemon data
(`GET /activity/timeline?limit=50`), draws four tracks (dispatches/sorties/agents/human),
event markers, **causal-thread beziers** with arrowheads, and a **playhead scrubbed** with
←/→, drag, or space. Its README is explicit: it *"does NOT touch `core/pd-console` or the
daemon"* and is *"excluded from the `core/` cargo workspace"* so the Linux `rust-console` CI
never compiles its heavy macOS GPU deps. **It proves the rendering ceiling** — and that the
v12 sensorium is buildable, not fantasy.

The problem it surfaces: two GPU stacks (gpui vs Vello/wgpu) cannot trivially co-exist in one
window, so the scrubber — and every v12 viz — has no home in the console as built.

## Decision

**The operator console is a gpui *shell*; bespoke-vector visualizations are Vello/wgpu
*surfaces* the shell hosts.** We do not port the viz down to gpui (loses the ceiling), and
we do not rewrite the console up to Vello (loses the multiplexer/editor + the Zed-class text).
We keep each stack doing what it is best at and bridge them.

Three bridge options were considered; the decision sequences two of them:

| # | Bridge | Verdict |
|---|--------|---------|
| 1 | Port viz to gpui | **Rejected** — gpui can't render the smooth beziers/scrub; defeats the purpose. |
| 2 | Embed a wgpu/Vello render surface *inside* the gpui window (custom GPU element) | **The target** — one window, viz as a first-class surface in the pane tree. Hard (shared device/queue, gpui custom-element hosting); the right long-term home for ghost-filetree / merge-as-light / biofield. |
| 3 | **Companion window** — gpui console summons the Vello viz as a child process/window | **Ship now** — the console execs the proven `pd-timeline` binary as a companion; the operator gets the scrubber in the loop this week with zero stack-mixing risk. |

**Now:** path 3 — a `Timeline` surface in the console launches the Vello companion window
against live daemon data. **Next (this ADR's forward work):** path 2 — embed Vello surfaces
in the gpui pane tree, which is also how the living-harbor viz lands.

### Why this is honest, not a dodge

A single-window, two-GPU-stack embed (path 2) is real systems work (sharing the `wgpu` device
with gpui's renderer, or compositing offscreen). Pretending the timeline can "just drop in" is
the hollowness this project keeps catching. Path 3 ships the *capability* immediately and de-risks
path 2 by keeping the Vello code running in production while the embed is built.

## Implementation Matrix

| Phase | Ships | Surface | State |
|------|-------|---------|-------|
| 0 (this ADR) | Decide gpui-shell + Vello-viz-surfaces; label-overlap fix in the proto | — | proposed |
| 1 (now) | `pd-timeline` installed binary; console `Ctrl-A` → **Timeline** execs it as a companion window over live `/activity/timeline` | companion window | path 3 |
| 2 | Embed a Vello/wgpu surface in the gpui pane tree (shared device); Timeline becomes an in-window pane | in-window pane | path 2 — forward work |
| 3 | Ghost filetree + merge-as-light + biofield as Vello surfaces (the v12 living harbor) | in-window panes | path 2 — forward work |

Phases 2–3 are roadmap-linked forward work, not promised by Phase 1.

## Consequences

- The viz code (Vello/Parley) stays **out of the `core/` workspace** and off the Linux CI gate
  — its macOS GPU deps never block `rust-console`. It builds + ships on the macOS path only.
- The console gains a real Timeline this week (path 3) without risking the multiplexer.
- Path 2 is the load-bearing bet for the entire v12 sensorium; this ADR commits to it as the
  direction and names the proto as the evidence it is reachable.
- Cross-platform: Vello/wgpu is portable (Vulkan/DX12/Metal), so the viz is not a macOS dead-end;
  gpui's Windows maturity remains the console's gating constraint (ADR-0046 / v11 §8), unchanged.

## References

- `core/pd-timeline-proto/README.md` — the proof spike (Vello + Parley + wgpu, live daemon data).
- `docs/design/fleetbar-mockups/operator-console-v11-SPEC.md` — picked gpui, deferred this fork.
- `docs/design/fleetbar-mockups/operator-console-v12-synthesis.html` — the living-harbor viz set.
- `skills/metal-text-pipeline/` — the pure-Metal tradeoff this proto deliberately avoided.
- Linebender: Vello (compute path renderer), Parley (shaping/layout), Kurbo (bezier geometry).
