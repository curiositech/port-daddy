# Converted Process Patterns

These diagrams retain the active relationships from imported process sketches; labels are options, not universal thresholds.

```mermaid
flowchart LR
  A[Read targeted file] --> B[Understand local structure] --> C[Edit bounded section] --> D[Run relevant check]
```
```mermaid
flowchart TD
  A[Lightweight plan] --> B[Read-only scout] --> C[Revise scope]
  C --> D{Independent verifiable branches?}
  D -->|Yes| E[Bounded fan-out]
  D -->|No| F[Serialize]
  E --> G[Synthesize]
  F --> G
  G --> H[Authorized action and verification]
```
```mermaid
flowchart LR
  A[Research A] --> D[Synthesize]
  B[Research B] --> D
  C[Research C] --> D
  D --> E[Choose next authorized action]
```
```mermaid
flowchart TD
  A[Candidate output] --> B[Evaluate criteria] --> C{Exit condition met?}
  C -->|Yes| D[Deliver]
  C -->|No| E[Repair material gap] --> A
```
```mermaid
flowchart LR
  A[Raw extraction] --> B[Filter noise] --> C[Enrich retained evidence] --> D[Final synthesis]
```
```mermaid
flowchart LR
  A[Think: goal and evidence] --> B[Act: narrow authorized tool] --> C[Assess observed result]
  C --> D{Exit condition met?}
  D -->|No| A
  D -->|Yes| E[Stop and report]
```

See [evidence-and-control-loop.md](evidence-and-control-loop.md) for unknown-effect reconciliation.
