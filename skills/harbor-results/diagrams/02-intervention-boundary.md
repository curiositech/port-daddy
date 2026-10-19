# CR-4 finite-fixture decision trace

```mermaid
flowchart TD
  I[Validate graph, values, costs and tolerances] --> R[Compute initial residual]
  R --> C{Within tolerance?}
  C -->|yes| A[already-consistent]
  C -->|no| B{Round budget remains?}
  B -->|no| L[round-limit]
  B -->|yes| Q[Recompute eligible energy/cost scores]
  Q --> P{Maximum score above threshold?}
  P -->|no| E[early-stop-zero-score]
  P -->|yes| M{Select highest-score row; mode?}
  M -->|sever| S[Remove row from model and eligibility]
  M -->|reconcile| Z[Zero value; keep row in model; remove eligibility]
  S --> T[Recompute modeled residual]
  Z --> T
  T --> G{Within tolerance?}
  G -->|no| B
  G -->|yes| H[completed: numerical fixture only]
```

Invalid shape, inconsistent edge binding or non-finite arithmetic raises a validation error. Every reported stop state returns the remaining residual and separates eligible rows from retained model rows. No stop state certifies an optimizer, truthful observations, or external authority. `reconcile` is a synthetic zero edit; a verified replacement protocol is separate.
