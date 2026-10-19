# Diagram 1: Separate policy decision from effect evidence

```mermaid
flowchart LR
  subgraph Offline[Policy preparation, offline]
    direction TB
    A[Policy version and scope] --> B[Draft verifier and explicit unknown rules]
    B --> C[Static and mutation checks]
    C --> D{Review and coverage complete?}
    D -->|No| E[Revise or hold policy]
    E --> B
    D -->|Yes| F[Pin verifier artifact and limits]
  end
  subgraph Effect[Per-action pre-effect path]
    direction TB
    G[Exact action proposal] --> H[Check current authority and inputs]
    H --> I{Policy verdict}
    I -->|DENY| J[No dispatch; record reason]
    I -->|INDETERMINATE| K[Hold; request evidence or authorized review]
    I -->|ALLOW| L[Controller redeems exact one-use admission]
    L --> M[Bind intent, target, digest, and idempotency/fence rules]
    M --> N[Send exact effect through inventoried boundary]
    N --> O[Witness or reconcile external effect]
    O --> P{Observed outcome}
    P -->|Applied| Q[Report scoped observed effect]
    P -->|Absent, current and fenced| R[Only then consider a new authorized attempt]
    P -->|Ambiguous| S[Hold and reconcile; do not blind retry]
  end
```

An admission receipt is not an exactly-once effect guarantee. DENY and INDETERMINATE never open the actuator path. Compensation is a separate authorized action, not execution of a denied operation. Static verifier checks do not prove that every effect route is mediated.
