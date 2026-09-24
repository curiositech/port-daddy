# Norm adoption and conflict routing

```mermaid
flowchart TD
 A[Source-tagged ANB candidate] --> B{Fresh activation true, expiry false, and bindings complete?}
 B -->|No or unknown| C[Retain candidate and prior instances; reconcile evidence]
 B -->|Yes| D[Record active bound NIB instance]
 D --> E[Evaluate joint plan witnesses for norm and intention constraints]
 E --> F{Plan coverage and effects complete?}
 F -->|No| U[Undetermined; preserve checked witnesses]
 F -->|Yes| G{Declared plan catalog empty?}
 G -->|Yes| V[No capability in this catalog; replan]
 G -->|No| H{Jointly safe plans}
 H -->|None| I[Retain conflict; compare feasible candidate subsets]
 H -->|Some| J[Record mixed result and witnesses]
 H -->|All| K[Record conditional model result]
 I --> L[Record partial comparisons and applicable policy]
 J --> L
 K --> L
 L --> M[Separate local desire proposal and BDI deliberation]
 M --> N[Independent effect admission]
```

The flow summarizes a local operational completion of the source model. NIB activation precedes desire deliberation; complete-plan classifications require joint witnesses. Separate effect admission does not imply that an effect was executed.
