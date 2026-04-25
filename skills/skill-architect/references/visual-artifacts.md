# Visual Artifacts and Mermaid Doctrine

Use visual artifacts when they improve reasoning, review, or downstream usability. Do not add them mechanically.

## Default stance

- Keep Mermaid raw in `SKILL.md` as the operative artifact.
- Prefer no rendered artifact unless the user or workflow benefits from it.
- Open HTML, SVG, or browser previews only when they materially improve inspection or decision-making.

## Mermaid type selection

Choose by information shape, not habit:

| Content shape | Mermaid type |
|---|---|
| branching process or troubleshooting | `flowchart TD` or `flowchart LR` |
| protocol, API timing, handoff | `sequenceDiagram` |
| lifecycle or status transitions | `stateDiagram-v2` |
| schema or entity relationships | `erDiagram` |
| class or interface structure | `classDiagram` |
| user journey or satisfaction flow | `journey` |
| chronology of events | `timeline` |
| project schedule | `gantt` |
| taxonomy or concept hierarchy | `mindmap` |
| git branching history | `gitGraph` |
| infrastructure view | `architecture-beta` |
| proportions | `pie` |
| two-axis comparison | `quadrantChart` |
| flow quantity | `sankey-beta` |
| numeric trend | `xychart-beta` |
| requirements trace | `requirementDiagram` |

## High-friction gotchas

- `journey` requires a 1-5 score for each task.
- `sankey-beta` is CSV-like and requires the `Source,Target,Value` header plus numeric values.
- `architecture-beta` has stricter edge semantics than `flowchart`.
- `gitGraph` semantics matter: checkout and merge direction are not decorative.
- `mindmap`, `timeline`, and some beta families are sensitive to indentation and renderer differences.

## Stability guidance

- Prefer stable types first.
- Use beta or plugin families only when simpler stable types would distort the content.
- If a beta type is required, say so in the skill or reference and expect renderer differences.
- For flowcharts, prefer explicit direction (`flowchart TD` or `flowchart LR`) instead of a bare `flowchart` declaration.

## Validation

After writing Mermaid, validate it structurally.

```bash
python scripts/validate_mermaid.py <path>
```

The validator catches common structural failures, but human review is still needed for indentation-heavy families.

For skills that ship many diagrams, keep an index so readers can load only the right artifact.

## When to render or open artifacts

Render or open browser artifacts only when one of these is true:

- a human must inspect the result visually
- the skill's output is naturally interactive
- layout, hierarchy, or topology are easier to review visually than as raw text
- the artifact is part of the deliverable

Examples:

- good fit: typography review board, design system explorer, codebase map, rich data analysis dashboard
- bad fit: ordinary troubleshooting flowcharts, small decision trees, tiny ER diagrams that are already readable in raw Mermaid

## Review surfaces

Treat review surfaces as explicit choices:

- `none`
- markdown brief
- JSON report
- Mermaid map
- HTML preview
- browser-open artifact

`browser-open` should be a deliberate affordance, not a default flourish.
