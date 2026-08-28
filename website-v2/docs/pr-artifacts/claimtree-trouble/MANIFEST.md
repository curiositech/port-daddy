# Claim-tree trouble visual proof

Captured headlessly from this branch's production build at `/docs/concepts/claim-tree`.
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
