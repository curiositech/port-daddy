# Typed prerequisite graph and separate admission review

```mermaid
flowchart TD
  C[Versioned contract artifact] -->|data| I[Implement]
  S[Storage decision record] -->|decision| I
  I -->|data: artifact and digest| T[Test]
  I -->|data: implementation artifact| D[Deploy]
  T -->|evidence: passing receipt| A[Release approval]
  T -->|evidence: matching receipt| D
  A -->|authority: matching subject| D
  D -->|data: deploy receipt| V[Verify]
  G[For each proposed work item] -. separate admission review .-> X{Inputs effects resources and authority valid?}
  X -->|yes| W[Eligible work item]
  X -->|no or unknown| H[Hold or revise]
```

The solid graph describes prerequisites, not observed execution. Test and approval receipts must bind the implementation digest consumed by deploy. The separate admission review supplies additional checks; an edge or topological layer does not grant effect authority.
