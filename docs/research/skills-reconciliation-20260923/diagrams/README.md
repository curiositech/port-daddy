# Research diagrams

These diagrams are teaching aids for the findings in the [field-gap report](../manuscript-field-gaps.md) and [substrate study explanation](../substrate-study-explained.md). They state evaluation boundaries and proposed procedures; they do not add experimental results, establish a product's capabilities, or claim a novel market. The evidence-class cards are parallel categories, not steps in a maturity ladder. A result in one class does not automatically transfer to another.

## Sources and renders

Each diagram has an editable Mermaid source (`research-*.md`) and a Graphviz DOT render source (`.dot`). The environment has Graphviz but no Mermaid renderer, so the SVG and PNG files are rendered from the semantically matched DOT source. Mermaid sources are not claimed as the source of those pixels. Keep labels, states, transitions, and decision outcomes aligned when editing either source.

`index.html` is a no-network gallery. Each SVG stays at its intrinsic width inside a horizontally scrollable, keyboard-focusable viewport; narrow screens scroll the canvas rather than shrinking text. PNG counterparts are included for quick inspection and portable use.

The gallery was opened in bundled Playwright Chromium at 1440 × 1000 and 390 × 844. Browser measurements confirmed the canvases remain keyboard-focusable and retain intrinsic image width; the evidence-class row and narrow-screen evaluation/state diagrams scroll horizontally. See [browser review](review-layout.md) and its full-page inspection captures.

## Layout choices

| Diagram | Graph family and reading task | Placement and routing | Stability and readability |
|---|---|---|---|
| Evidence classes | Five independent category cards; compare what each evidence class supports and leaves open | Fixed left-to-right row; no visible links; actual card dimensions from full text; no force layout | Explicit ordering in source keeps the neutral catalogue stable. At small widths, scroll the intrinsic canvas. |
| Matched-budget evaluation | Directed workflow with a branch at the preregistered decision | Top-to-bottom layered flow; straight/polyline routes; assignment exposes factorial skill × substrate arms | Fixed stage order; full labels remain inside nodes; terminal outcomes are separate. |
| Uncertain-effect recovery | Directed state machine with one retry loop and safe hold states | Top-to-bottom layered flow; polyline routes; retry loop wraps around the main stages | Explicit states and labeled transitions; no force layout. Unknown and unresolved remain visible states. |

The diagrams use large text and short claims. Long definitions live in the report and gallery notes. There are no decorative edges in the evidence-class catalogue because a connecting arrow could imply that one class proves or progresses into another.

## Reading notes and sources

- `research-evidence-classes`: the report's evidence boundaries in its claim inventory and gaps 1, 3, and 8. The cards name a supportable claim and a boundary; they do not rank evidence quality without regard to the question.
- `research-matched-budget-evaluation`: gap 2's randomized skill-availability design and gap 8's matched-budget LLM comparison, combined as a reusable evaluation flow. It is a protocol sketch, not a claim that this experiment ran. For the substrate-specific defect and repair agenda, read the [study explanation](../substrate-study-explained.md).
- `research-uncertain-effect-recovery`: gap 5's effect-aware recovery matrix. Timeout is unknown; only reconciliation can establish applied or absent state. A retry requires stable idempotency identity and current authority. A successor needs a fresh scoped grant.

The two reusable diagrams are copied under `skills/empirical-systems-evaluation/diagrams/` as `research-*` sources and renders. Both diagrams are linked from the canonical skill's entrypoint and diagram index after review.
