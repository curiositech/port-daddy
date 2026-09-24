# Mermaid semantic drafts

## Obligation-complete context compilation

```mermaid
flowchart LR
    A["A · cost 4 · R1, R2"] -->|admissible| P["Pack A + C · cost 6 / budget 6"]
    C["C · cost 2 · R4"] -->|admissible| P
    B["B · cost 3 · R3"] -.->|disclosure denied| X["R3 BLOCKED"]
    P --> Y["Receipt<br/>R1=A · R2=A<br/>R3=BLOCKED · R4=C"]
    X --> Y
    Y --> L["Declared coverage only · no effect authority"]
```

## Selection-aware skill promotion

This scatter-style comparison is intentionally limited to the constructed ranking reversal. The Book port adds the separate evidence lane: adaptive routing records hypotheses about policy, strata, support, use, and outcome; fresh version-pinned held-out evaluation precedes a release decision.

```mermaid
quadrantChart
    title Constructed ranking changes when the task mix changes
    x-axis "Lower observed raw rate" --> "Higher observed raw rate"
    y-axis "Lower equal-mix rate" --> "Higher equal-mix rate"
    quadrant-1 "High under both views"
    quadrant-2 "Equal-mix advantage"
    quadrant-3 "Low under both views"
    quadrant-4 "Raw-rate advantage"
    S: [0.833, 0.700]
    T: [0.636, 0.800]
```
