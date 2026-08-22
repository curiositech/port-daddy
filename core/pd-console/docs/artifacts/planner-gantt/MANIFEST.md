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

## Safety

No window, no display, no Screen-Recording (TCC) permission — agent-safe by
construction; the raster never touches the window server.
