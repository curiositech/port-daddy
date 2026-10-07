# Conditional commitment scope

```mermaid
flowchart TD
    C[Conditional request] --> T{Semantic family}
    T -->|one condition occurrence| W[request-when]
    T -->|each later false-to-true occurrence| R[request-whenever]
    T -->|persistent referential notification| S[subscribe]
    W --> X[Cancel or later refusal can end commitment]
    R --> X
    S --> X
    X --> P[Monitoring frequency and action lag require local agreement]
```

XC00037H distinguishes one-time, persistent, and referential notification forms. It does not set a monitor interval, trigger-to-action lag, or cancellation-delivery guarantee.
