# HTP applicability and required local checks

The source describes a rule-guided outline procedure. This decision aid does not impose a chain-length threshold or select an execution architecture.

```mermaid
flowchart TD
  Q[Problem q and candidate rule library R] --> D{Does a rule match a divisible concern?}
  D -->|no| L[Keep the concern as a leaf]
  D -->|yes| S[Instantiate its child-set]
  S --> C{Child set preserves the stated concern and constraints?}
  C -->|no| X[Revise or reject the local rule application]
  C -->|yes| O[Add the branch to outline O]
  L --> O
  O --> N{Further divisible leaves remain?}
  N -->|yes| D
  N -->|no| G[Use O to guide leaf content C]
  G --> P[Assemble candidate plan P]
```
