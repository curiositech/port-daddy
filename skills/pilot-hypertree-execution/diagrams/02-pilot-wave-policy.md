# Pilot wave policy: eligibility, capacity, and evidence

```mermaid
flowchart TD
  C[Enumerate candidate clusters and typed edges] --> D{Hard artifacts accepted?}
  D -->|no| H[Hold or replan]
  D -->|yes| I{Semantic interfaces reviewed?}
  I -->|no| H
  I -->|yes| A{Authority resources and budget declared?}
  A -->|no| H
  A -->|yes| K{Eligible count within declared cap?}
  K -->|no| Q[Queue eligible clusters by stated policy]
  K -->|yes| W[Propose a wave; no dispatch or effect implied]
  W --> O{Observed outcome recorded?}
  O -->|accepted completion| N[Hard consumers may recheck readiness]
  O -->|rejected or unknown effect| H
  Q --> R[Reassess after evidence or policy change]
  H --> R
```

The cap governs proposed-wave admission only. A consumer becomes eligible only after its specific accepted hard artifact and its own admission checks; an unknown prior effect remains unresolved rather than becoming success.
