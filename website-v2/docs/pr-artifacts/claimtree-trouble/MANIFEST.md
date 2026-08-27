# Claim-tree trouble visual proof

Captured headlessly from this branch's production build at `/docs/concepts/claim-tree`.
The figure is the same bounded ego graph introduced in the docs: `session-you`
and `session-other` converge on the synthetic lib/auth.ts surface, producing the explicit
`COORDINATE` state and its next action.

| Artifact | Shows |
| --- | --- |
| `ego-graph-light.png` | The human-facing graph in the light theme. |
| `ego-graph-dark.png` | The same semantic colors and readable labels in dark theme. |
| `ego-graph-focus.webm` | The rendered graph in the live production build, brought into focus and animated in place. |

The recordings are captured from the actual React component after the route is
loaded; they are not a mockup or a hand-drawn substitute.
