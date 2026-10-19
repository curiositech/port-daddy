# Pilot edge semantics and admission boundary

```mermaid
flowchart TD
  P[Endpoint core produces candidate artifact] --> V{Accepted producer artifact and version?}
  V -->|no| R[Hold or replan producer]
  V -->|yes| S{Semantic and API interface compatible?}
  S -->|no| R
  S -->|yes| A{Authority scope declared?}
  A -->|no| H[Hold: no admission or effect]
  A -->|yes| U{Required resource and budget available?}
  U -->|no| H
  U -->|yes| E[Eligible for proposed wave only]
  E --> C[Static cleanup may be considered]
  W[Website cluster] -. order preference .-> M[Roadmap merge review order]
```

A hard producer-to-consumer relation requires an accepted artifact and the consumer’s semantic-interface, authority, and resource checks. The order edge only records review preference. Eligibility is not dispatch, completion, or authorization for an external effect.
