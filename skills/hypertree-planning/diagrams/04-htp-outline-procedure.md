# HTP outline procedure: retained-hyperchain and sampled-rule loops

```mermaid
flowchart TD
  Q[Query q and rule library R] --> D[Derive divisible rule starts D]
  D --> H[Generate candidate hyperchains at depth d]
  H --> W{More than width W?}
  W -->|yes| F[Use stated width confidence or model filter]
  W -->|no| L[Keep all candidates]
  F --> L
  L --> C[For each retained hyperchain]
  C --> S[Select a divisible leaf g-star in its context]
  S --> R[Retrieve or sample P applicable rules]
  R --> B[For each sampled rule instantiate its complete child set]
  B --> A[Attach that child set as one alternative branch below g-star]
  A --> M{More sampled rules?}
  M -->|yes| B
  M -->|no| N{More retained hyperchains?}
  N -->|yes| C
  N -->|no| T{Depth limit or no divisible leaf?}
  T -->|no| H
  T -->|yes| O[Select a final hyperchain as outline O]
  O --> K[Self-guide leaves with permitted knowledge to C]
  K --> P[Generate final plan P]
```

Each sampled rule is an alternative decomposition branch. Each selected rule’s child set remains together inside that branch. The diagram models source-level outline construction; it neither schedules children nor grants any execution effect.
