# Visual proof — roadmap board Gantt with real estimates

Why these exist: the planner/Gantt slice is a visual surface, and the PR
contract requires artifacts of the actual render, not a green build. All four
files were captured from a **live daemon** (this branch's `server.ts` on
`http://127.0.0.1:9876`) after seeding `roadmap_items` with estimates,
priorities, assignees, and dependency edges through the new planner-column
write path (`POST /roadmap/items`).

- [board-gantt.png](./board-gantt.png) — `GET /roadmap/board`, Gantt tab:
  bar geometry now comes from real `roadmap_items.estimate` values (a
  5-unit epic is five times the width of a 1-unit task), critical-path bars
  highlighted — a duration chart, not the old unweighted
  topological-depth chart (`gantt-real-estimate-wiring`). The chart carries
  a labeled time axis: unit 0 anchored at render time under the declared
  convention 1 estimate unit = 1 day, a teal `today` marker, real `MM-DD`
  date labels at an adaptive cadence (day → 2-day → week → fortnight →
  4-week → quarter as the span grows), and gridlines aligned to the bars'
  percent geometry.
- [board-tree.png](./board-tree.png) — the same board's Tree tab: status /
  priority / critical-path chips per item, estimate and slack inline.
- [board-walkthrough.gif](./board-walkthrough.gif) /
  [board-walkthrough.webm](./board-walkthrough.webm) — recorded headless-
  Chromium walkthrough switching Tree ↔ Gantt on the live board.

The pd-console half of the slice (the Planner pane's leading critical-path
Gantt) has its own Block-raster proof under
`core/pd-console/docs/artifacts/planner-gantt/MANIFEST.md`, captured with the
new `pd-console-repl --capture-planner` flag against the same live daemon.
