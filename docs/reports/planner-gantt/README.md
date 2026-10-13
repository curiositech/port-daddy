# Visual proof — roadmap board Gantt with real estimates

Why these exist: the planner/Gantt slice is a visual surface, and the PR
contract requires artifacts of the actual render, not a green build. All four
files were captured from a **live daemon** (this branch's `server.ts` on
`http://127.0.0.1:9876`) after seeding `roadmap_items` with estimates,
priorities, assignees, and dependency edges through the new planner-column
write path (`POST /roadmap/items`).

- [https://media.portdaddy.dev/sha256/17/174645d4c8cf4db640cfb26f84bd4af0bd53730f69c4d808dc948011bc97f9ca.png](https://media.portdaddy.dev/sha256/17/174645d4c8cf4db640cfb26f84bd4af0bd53730f69c4d808dc948011bc97f9ca.png) — `GET /roadmap/board`, Gantt tab:
  bar geometry now comes from real `roadmap_items.estimate` values (a
  5-unit epic is five times the width of a 1-unit task), critical-path bars
  highlighted — a duration chart, not the old unweighted
  topological-depth chart (`gantt-real-estimate-wiring`). The chart carries
  a labeled time axis: unit 0 anchored at render time under the declared
  convention 1 estimate unit = 1 day, a teal `today` marker, real `MM-DD`
  date labels at an adaptive cadence (day → 2-day → week → fortnight →
  4-week → quarter as the span grows), and gridlines aligned to the bars'
  percent geometry.
- [https://media.portdaddy.dev/sha256/4e/4e00da94d13f516306059a22e1b4d9faeb0bfd3c22758bd087f89059cf532bb6.png](https://media.portdaddy.dev/sha256/4e/4e00da94d13f516306059a22e1b4d9faeb0bfd3c22758bd087f89059cf532bb6.png) — the same board's Tree tab: status /
  priority / critical-path chips per item, estimate and slack inline.
- [https://media.portdaddy.dev/sha256/b2/b20741b45a2a12746aa2cca8b936c7154e590ecfb16f313a79cafe88e99e4069.gif](https://media.portdaddy.dev/sha256/b2/b20741b45a2a12746aa2cca8b936c7154e590ecfb16f313a79cafe88e99e4069.gif) /
  [https://media.portdaddy.dev/sha256/3e/3e4538925824b434479bbd28a0eeb4617f6fa4fa1307d77d2ca465512b703cf6.webm](https://media.portdaddy.dev/sha256/3e/3e4538925824b434479bbd28a0eeb4617f6fa4fa1307d77d2ca465512b703cf6.webm) — recorded headless-
  Chromium walkthrough switching Tree ↔ Gantt on the live board.

The pd-console half of the slice (the Planner pane's leading critical-path
Gantt) has its own Block-raster proof under
`core/pd-console/docs/artifacts/planner-gantt/MANIFEST.md`, captured with the
new `pd-console-repl --capture-planner` flag against the same live daemon.
