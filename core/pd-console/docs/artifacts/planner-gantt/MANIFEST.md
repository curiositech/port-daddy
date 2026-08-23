<!-- pd-console-proof-metadata
{
  "schema": "pd-console.visual-proof.v1",
  "artifactKind": "manifest",
  "captureCommitPolicy": "generated-by-capture-flag-at-pr-commit",
  "artifactStatus": "current-block-model-raster",
  "proofScope": "planner-pane-critical-path-gantt",
  "providerTranscriptE2E": false,
  "dryRun": false
}
-->

# Planner pane — critical-path Gantt leads the first screen

Provenance: **Block-model offscreen raster** captured against a **live daemon**
via the headless repl's `--capture-planner <path.png>` flag
(`headless_capture::render_blocks` over the pane's real `view()` output, locked
DARK theme), NOT a GPUI/Metal framebuffer capture — the pinned `gpui = 0.2.2`
exposes no offscreen Metal readback (see `src/headless_capture.rs`). The GPUI
face paints the SAME `Block`s; this PNG is the render-agnostic contract made
visible.

Capture command (daemon on the stable berth, roadmap seeded with estimates and
dependencies through `POST /roadmap/items`):

```
PORT_DADDY_URL=http://127.0.0.1:9876 pd-console-repl --capture-planner console-planner-gantt.png
```

## Artifacts

- [console-planner-gantt.png](./console-planner-gantt.png) — the Planner
  pane's leading Gantt section: CPM schedule from the kernel `pd-anchor`
  scheduler (ADR-0086) over the remaining roadmap items, makespan + critical
  count + the time-unit convention in the header, a labeled time axis
  directly above the bars (tick 0 = `today`, real `MM-DD` dates at the
  adaptive day/week/fortnight/quarter cadence of `axis_tick_step`, ruler
  ticks on the same integer cell mapping the bars use), solid bars for the
  critical chain, hatched bars with slack (`sN`) for everything else,
  per-bar estimate (`eN`), followed by the epic tree the pane always
  rendered.

The schedule math itself (dependency chaining, critical marking, done-item
exclusion, unsized-item default, cycle refusal, bar/label budgets) is covered
by unit tests in `src/planner_pane.rs`.

Known raster limitation, stated honestly: the capture font ships glyph
coverage for the box-drawing rails but not for the `█`/`▓` bar fills, so the
PNG draws each bar cell as a box outline. Bar POSITION, LENGTH, and the
`eN`/`sN`/`CRIT` annotations — the schedule the proof exists to show — are
exact; the solid-vs-hatched fill distinction is visible in the GPUI/terminal
faces, which render the same Blocks with a full font.

- [console-planner-gantt-date-anchored.png](./console-planner-gantt-date-anchored.png)
  — same pane, seeded with one item carrying real `startedAt`/`dueAt` 3 and 8
  days out (`POST /roadmap/items` with both fields set) alongside two plain
  items with only an `estimate`. Proves the date-anchoring pass added in this
  slice end to end against a live daemon, not just in unit tests: the
  `adr-0086-phase-2-gantt-anchor` row's bar starts past the `today` tick and
  its `DATED` tag is visible in the meta column, and the time axis WIDENS
  past the 4-day CPM makespan (header still reports "makespan 4 day(s)" —
  the kernel's true CPM answer, untouched) out to the `08-29` tick so the
  real due date fits inside the 40-cell lane instead of overflowing it — the
  render-span-widening logic this slice added.

  Capture command (same daemon/flag shape, after seeding one dated item):
  ```
  curl -sX POST http://127.0.0.1:PORT/roadmap/items -d '{"slug":"adr-0086-phase-2-gantt-anchor", …, "startedAt": <ms>, "dueAt": <ms>}'
  PORT_DADDY_URL=http://127.0.0.1:PORT pd-console-repl --capture-planner console-planner-gantt-date-anchored.png
  ```

## Safety

No window, no display, no Screen-Recording (TCC) permission — agent-safe by
construction; the raster never touches the window server.

## Motion artifact

- [planner-gantt-before-after.gif](./planner-gantt-before-after.gif) — a
  two-frame flip between the two rasters above: the relative-CPM baseline
  (`console-planner-gantt.png`, every bar packed against `today`) and the
  date-anchored capture (`console-planner-gantt-date-anchored.png`, the
  `DATED` row's bar displaced to its real `startedAt`, axis widened to its
  real `dueAt`). Assembled from the committed PNGs with a pure-JS GIF
  encoder (gifenc + pngjs; frames padded to a common canvas) because this
  sandbox has no `vhs` binary and no `ffmpeg` (package mirrors 404 on its
  transitive deps) — so a `vhs` tape of the live TUI remains the better
  artifact for a follow-up from an environment that has those tools. Both
  source frames are real, live-daemon block-model rasters, not mocks; the
  GIF adds no new evidence beyond juxtaposing them in time.
