# Porthole — kill the GIFs, replay the truth

**Status:** prototype validated (this directory) · **Date:** 2026-08-18 · **Session:** cli-output-capture-viz

The website's CLI demos are GIFs: lossy, truncated, unreviewable, uncopyable, and in several
cases fabricated or shipping errors on camera (see `AUDIT-2026-08-18.md`). This plan replaces
the entire pipeline with honest timestamped captures replayed as **real, selectable DOM text**
— and makes the CLI itself worth recording.

## 1. The three-part program

### A. Capture: asciicast is the natural representation — use it, don't invent one
The "unicode char + color + timestamp" format the operator asked for **exists**: asciicast.
- **Source of truth: asciicast v3** (`asciinema rec` ≥3.0 default). NDJSON; header carries
  `term.cols/rows/theme` (the *actual* palette at record time), events are `[delta, "o", bytes]`,
  plus `m` markers and `x` exit-status — so the site can honestly render "exited 0".
  Spec: https://docs.asciinema.org/manual/asciicast/v3/
- **v2↔v3 gotcha:** v2 timestamps are absolute, v3 are deltas. Parse both (prototype does).
- **Capture doctrine:** single-shell evidence uses `asciinema rec --window-size 100x28 -c <driver>`;
  real split-pane/tmux evidence uses the separately pinned `120x34`. Pinned profiles mean no
  `r` resize events; typing simulated, **output 100% real**, zero filtering, zero `sed -n '1,18p'`.
  `demos/porthole/drive.sh` is the reference driver. Never pass `-I` (records keystrokes/secrets).
- Keep VHS `.tape` files as the *driver/DSL* for reproducible CI demos, but record them to `.cast`,
  not GIF. VHS `.ascii` output doubles as a golden-file rendering test.

### B. Replay: interpret the cast, render stable DOM lines ("Porthole")
`asciinema-player` is disqualified: fixed `cols×rows` viewport, **no scrollback** (long output is
lost — the exact GIF failure), and pooled/recycled row nodes (nothing to hang a per-line copy
affordance on). xterm.js in-browser is canvas — not real text. So:

- **Architecture:** feed cast bytes through a VT interpreter → an append-only transcript of
  styled lines keyed by **absolute line index** (scrollback never dropped) → render each line as
  a stable `<div><span style=…>` — native selection, per-line hover-copy, full-text search.
- **Prototype (this dir, `porthole.html`):** ~250-line client-side VT (SGR 16/256/truecolor,
  CR-overwrite, EL/ED, cursor moves, OSC skip) + player chrome: iTerm2-style window,
  0.25×/0.5×/1×/2× speed, scrub, pause, autofollow with "resume" pill, hover ⧉ line-copy,
  copy-transcript, scroll cues, provenance strip. Zero dependencies. Verified headless
  (Playwright): 92-line transcript fully retained and scrollable in a 28-row viewport.
- **Production version (website-v2):** do interpretation at **build time** with
  `@xterm/headless@6` (devDependency; `await` the `write()` callback!) emitting a
  line-snapshot JSON (`lines[]` final state + `frames[]` timed updates); ship a ~200-line React
  component, zero runtime deps. Segment prompt/command/output into Warp-style **blocks**
  (pre-scan for OSC 133 or drive.sh sentinel) so copy affordances live at block *and* line level.
- **Known limits (decide before recording):** alt-screen TUIs have no scrollback by design —
  render them as a fixed-height sub-viewport or don't feature them; wide glyphs need
  `@xterm/addon-unicode11`; clamp idle gaps at build time (keep `dtRaw` for honesty).

### C. Make the CLI worth recording
Grounding: `cli/utils/ui.ts` already has the linework panel system + ICS signal flags;
`ink@6.8` is a dependency but **unused by the CLI** (only `dashboard/tui.tsx`). The gap is
motion, liveness, interactivity, and scripted demo fixtures. Ranked moves:
1. **`pd salvage` interactive** — the flagship demo: derelict list → mark → progress with real
   ETA → salvage-manifest receipt. A story arc, not a printout.
2. **`pd status` harbor board** — breadcrumb header, sparkline column (`▁▂▃▄▅▆▇█`), mandatory
   next-action footer, `--watch` bounded live region (NOT alt-screen), `--plain`/`--json` always.
3. **`pd fleet live`** — the only alt-screen TUI (Ink 7 `alternateScreen`), tabs + persistent
   footer keybar + `/` filter. Requires validating **ink@7.1.1 under `bun build --compile`**
   (yoga WASM + react-reconciler — the plan's biggest technical risk; fall back to clack).
4. **Session bookends** (`begin`/`done`) — 4-beat ceremony ending in a receipt card with OSC 8
   links. `pd claim` conflicts show *who/how long/hail them*, not just an error.
5. **`pd demo` fixture harbor** — deterministic seeded scenario every tape drives, so recordings
   never churn on volatile IDs/timestamps and never leak the operator's real registry.
6. Correctness papercuts found by research: `NO_COLOR=""` should mean *unset*; add
   `TERM=*-direct`, `CLICOLOR/CLICOLOR_FORCE`; split `glyphs` from `colorLevel`; vetted
   width-1 glyph allowlist + unit test; `stripAnsi` must strip OSC 8 before width math.
7. **Brand the recording, not the user's terminal:** demos set IBM Plex Mono + paper/ink/cobalt
   theme via the recorder; the product respects the user's theme and NO_COLOR.

## 2. Gate hardening (the audit's teeth)
The current gate cannot catch what's wrong (typed commands are char-split so path-leak regexes
never match; root casts unscanned; CI validates fresh throwaway output, never committed assets).
New gate requirements, in order:
1. Replay every committed cast through the same VT → assert: no `Unknown command`, no `✗`, no
   empty payoff output, no `/Users/…` **in the reconstructed transcript** (defeats char-splitting),
   no daemon-version drift within one cast (catches splicing), exit-status event = 0.
2. Delete the landing page's fabricated typewriter terminal (`TerminalDemos.tsx`) — replace with
   Porthole embeds. Kill `object-cover` on every terminal asset (it crops ~13% off).
3. Remove the 4 dead root casts, 1-frame dark stubs, and the 3 missing-GIF references on /harness.

## 3. Rollout
1. Land Porthole component in website-v2 + build-time transcript compiler (+ the gate above).
2. Re-record the ~44 load-bearing recordings against `pd demo` fixtures at 100×28, review each
   transcript (the gate now reads them as text — reviewable in PR diffs!).
3. CLI delight sprint (C.1–C.5) → re-record the hero set.
4. Provenance strip on every embed (source/version/date/fidelity) per agent-visual-evidence-manifest.

Full research reports (formats/player, CLI patterns, audit) are preserved in the PR body and
`AUDIT-2026-08-18.md`. Prototype usage: `python3 -m http.server` here, open `porthole.local.html`.
