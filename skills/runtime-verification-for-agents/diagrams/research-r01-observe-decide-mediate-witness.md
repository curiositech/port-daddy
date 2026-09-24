# R01 — Observe, decide, mediate, witness

The upper lane is post-event observation; the lower lane gates dispatch before
the effect. A `PASS` from observation does not authorize or prevent an effect.

```mermaid
flowchart TB
  subgraph Observe[Post-event observation: detect only]
    E[Covered event or snapshot] --> M[Monitor evaluates versioned property]
    M --> V{Result}
    V -->|PASS| P[Record scoped pass]
    V -->|VIOLATION| X[Record finding and notify owner]
    V -->|UNKNOWN| U[Record uncertainty and reconcile]
  end
  subgraph Dispatch[Pre-effect admission: prevention only at this boundary]
    R[Effect request] --> C[Independent controller reads fresh verdict]
    C --> D{Decision}
    D -->|DENY| B[Do not dispatch]
    D -->|UNKNOWN| H[Hold and request evidence]
    D -->|PERMIT| F[Dispatch scoped effect]
    F --> W[Independent effect witness]
  end
  P -. observation does not authorize dispatch .-> R
```
