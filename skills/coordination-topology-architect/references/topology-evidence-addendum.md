# Topology Evidence Addendum

```mermaid
flowchart TD
  A[Work description] --> B{Dependencies determine order?}
  B -->|Yes| C[DAG]
  B -->|No| D{Gate verdict routes work?}
  D -->|Yes| E[Workflow]
  D -->|No| F{Shared artifact triggers specialists?}
  F -->|Yes| G[Blackboard]
  F -->|No| H[State remaining assumptions]
```

```mermaid
sequenceDiagram
  participant P as Planner
  participant X as Executor
  participant V as Verifier
  P->>X: topology and acceptance rule
  X-->>V: artifact plus observed evidence
  V-->>P: pass, repair route, or unresolved assumption
```

The topology label should describe who routes work and where state changes, not imply runtime capabilities. The workflow-pattern study catalogs control-flow patterns and compares workflow-language capabilities [van der Aalst et al., 2003](https://doi.org/10.1023/A:1022883727209); Nii describes blackboard application and skeletal systems [Nii, 1986](https://doi.org/10.1609/aimag.v7i3.550). These works inform the pattern vocabulary; they do not prescribe universal worker counts, routing thresholds, or product support.
