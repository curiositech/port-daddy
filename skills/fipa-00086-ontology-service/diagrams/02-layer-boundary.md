# Meaning and effect boundaries

The C body distinguishes ontology vocabulary/axioms, knowledge-base assertions and intended interpretations. The validation and authorization choices below are local application policy; a layer's output does not prove the next layer's claim.

```mermaid
flowchart TD
    X[Received bytes or expression] --> P{Syntax understood?}
    P -->|no| N[Unresolved input; no new effect]
    P -->|yes| O[Identify ontology vocabulary and axioms]
    O --> K[Interpret knowledge-base assertions]
    K --> M[Identify intended task consequence]
    M --> V{Result present and task fixture passes?}
    V -->|no or unknown| N
    V -->|yes| A{Effect authorized by local policy?}
    A -->|no or unknown| D[Hold effect; resolve authority]
    A -->|yes| E[Effect may be attempted]
    E --> R[Read independent effect result]
```

An authorized attempt is not an observed success. Missing response or a failed semantic fixture does not prove that a previously attempted external effect was rolled back; reconcile that earlier attempt separately.
