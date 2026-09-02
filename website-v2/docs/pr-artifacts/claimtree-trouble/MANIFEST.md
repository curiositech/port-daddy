# Claim-tree trouble visual proof

Captured headlessly (Playwright, `capture.mjs`) from this branch served by the vite dev server at `/docs/concepts/claim-tree`, after fixing the Mermaid render pipeline (invalid `var()` classDefs, silent render failure, and the reduced-motion CSS rule that corrupted Mermaid layout site-wide).
The figure is the interactive claim-tree trouble visualizer: a Mermaid bounded
graph with a color-safe state legend, an inspection panel, and reduced-motion
behavior that keeps the swap instant.

| Artifact | Shows |
| --- | --- |
| `ego-graph-light.png` | Light theme with the default inspected state and the legend pinned beside it. |
| `ego-graph-dark.png` | Dark theme with the same selected state, colors, and labels. |
| `ego-graph-focus.webm` | The live visualizer moving between states while the inspection panel and Mermaid node update together. |

The recordings are captured from the actual React component after the route is
loaded; they are not a mockup or a hand-drawn substitute.
