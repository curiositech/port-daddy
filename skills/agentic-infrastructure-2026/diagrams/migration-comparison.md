# Controlled migration comparison

```mermaid
flowchart TD
  T[Freeze matched task set] --> B[Run baseline]
  T --> C[Run candidate]
  B --> OB[Record outcomes and costs]
  C --> OC[Record outcomes and costs]
  OB --> J[Compare paired tasks and failures]
  OC --> J
  J --> D{Evidence supports next step?}
  D -->|No| R[Keep baseline; revise candidate]
  R --> F[Freeze fresh matched set]
  F --> T
  D -->|Yes| G[Named reviewer checks scope, authority, rollback]
  G -->|Approve| P[Bounded pilot under separate authorization]
  G -->|Hold or stop| H[Record hold or stop with owner]
  D -->|Inconclusive| I[Hold; define additional evidence]
  I --> F
```

The diagram separates evaluation from rollout: a positive task comparison does not itself admit a live pilot. A named reviewer must approve its scope, authority, owner, and rollback path; a hold or stop remains valid. If results drive candidate changes or more evidence is needed, define a fresh matched task set rather than reusing exposed holdout tasks as fresh evaluation. A positive result is scoped to the task set, versions, and conditions recorded.
