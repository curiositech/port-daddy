# Group, flow, and side-model check

```mermaid
flowchart LR
  R[Requester R] -->|payment| O[Operator O]
  O -->|lease payment| W[Asset owner W]
  O -->|license payment| L[Skill licensor L]
  O -->|transaction fee| P[Intermediary P]
  W -. participation availability .-> R
  L -. participation availability .-> R
  R -. demand response .-> W
  R -. demand response .-> L
  O -->|control request: proposed only| A[Worker or fleet]
  A -->|delivery evidence| O
  O -->|outcome signal: scope stated| S[Reputation record]
  M{Named groups, outside options,
multihoming, elasticities, and
cross-group counterfactual?}
  R --> M
  W --> M
  L --> M
  P --> M
  M -- insufficient --> U[Side count unresolved;
no pricing conclusion]
  M -- stated model --> Q[Evaluate price-structure hypothesis]
```

**Edge legend:** solid edges are constructed money/control/evidence/signal flows; dotted edges are hypothesised participation effects. Role count does not determine side count. The diagram does not grant O authority over A or establish a settled reputation outcome.
