# Design work pulled from stranded branches

Per request: "pull all of the design work into a scratch/design/ folder."
One folder per source branch. Two families:

## Swiss/Maritime design system (`design-swiss-*`)
Four branches (`swiss-console-v2`, `swiss-gallery-v2`, `swiss-scout-v2`,
`swiss-webapp-v2`) each apply the same shared `swiss-maritime-tokens.css`
(Müller-Brockmann grid, IBM Plex + Recursive type, maritime-flag-semaphore
palette) to one operator surface. Open any `index.html` directly in a browser.
Bears on the book's own open Swiss-edition decision as a possible visual
reference, even though it's a different product surface (the console, not the
book).

## FleetBar/console TUI mockup history (`design-tui-fleetbar-mockups`,
## `design-tui-v7-multiview`, `operator-console-v11-synthesis`)
These three branches turned out to hold **the same iteration sequence**
(`operator-tui-v2.html` through `v9`/`v10`, plus `archive.html`,
`gallery.html`, `persona-synthesis.html`, `research-report.html`,
`typography-comparison.html`) — a progressive design history, not three
distinct designs. `operator-console-v11-synthesis/` has the fullest set,
including the latest `operator-tui-v10-living-harbor.html` (pheromone heat,
firefly agents, a full CSS token system) that the other two don't carry.
Start there; the other two folders are largely redundant with it.

## Prototype interaction studies (`proto-*`, 8 folders)
Each is one self-contained HTML/canvas/WebAudio prototype exploring a
bio-inspired or cinematic metaphor for visualizing agent-swarm activity
(fireflies as agents, pheromone heat-glow, a merge-as-light convergence flash,
a WebAudio "Fleet Breathing" soundscape, a cinematic galaxy view). All eight
share one design-token vocabulary and motion grammar even though built as
separate motif studies — open each `.html` directly in a browser.
