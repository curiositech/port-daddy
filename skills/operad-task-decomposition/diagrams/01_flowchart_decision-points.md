# Subworkflow boundary, slot, and contract review

```mermaid
flowchart TD
  Q[Proposed subworkflow replacement] --> I[Declare outer interface, inner slots, artifacts, and effects]
  I --> S{Every input slot has a typed source and every output a consumer or terminal?}
  S -->|no| R[Repair the boundary contract]
  S -->|yes| G{Chosen operad grammar and substitution map stated?}
  G -->|no| R
  G -->|yes| F[Form the candidate composite]
  F --> M{Mathematical equality claim?}
  M -->|yes| L[Check units, associativity, equivariance, and a compatible algebra]
  M -->|no| W[Check selected workflow DAG and sharing contract]
  L --> B{Implementation bindings, authority, effects, and resources evidenced?}
  W --> B
  B -->|no| H[Hold: no execution conclusion]
  B -->|yes| E[Review trace and outcome evidence]
```

The first branch reviews formal substitution; the second reviews a chosen workflow restriction. Both retain implementation, authority, effect, and observation obligations outside the operad laws.
