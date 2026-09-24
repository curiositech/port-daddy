# Shared-platform adoption

```mermaid
flowchart TD
  P[Name workload, stakeholders, and support owner] --> B[Measure current process baseline]
  B --> D[Build the smallest shared capability]
  D --> S[Freeze development and untouched evaluation tasks]
  S --> E[Compare baseline and candidate on current held-out tasks]
  E --> R{Quality, effects, recovery, and cost acceptable?}
  R -->|No| F[Revise on development cases]
  F --> N[Freeze a fresh untouched evaluation set]
  N --> E
  R -->|Yes| O[Opt-in bounded pilot]
  O --> L[Review support load, user impact, and exceptions]
  L --> X{Evidence supports expansion?}
  X -->|No| F
  X -->|Yes| G[Expand by named workload and owner]
  G --> Z[Maintain retirement and rollback path]
```

No calendar or team-count threshold is implied. If a revision or expansion decision uses results from the current held-out set to change a candidate, freeze a new untouched evaluation set before the next comparison; do not send the repair loop back through the exposed set. Each gate is chosen for the workload and the consequences of failure.

## Shared-service boundary

This converts the original platform “provides/consumes” sketch. The exact service interface remains a local design choice.

```mermaid
flowchart LR
  subgraph Studio[Shared enablement service]
    A[Versioned adapters]
    E[Evaluation templates]
    C[Cost attribution]
    D[Deployment guidance]
    O[Observability guidance]
  end
  subgraph Teams[Workflow-owning teams]
    W[Team workflow and data]
    P[Team effect policy and acceptance]
    S[Support and incident owner]
  end
  A --> W
  E --> W
  C --> W
  D --> W
  O --> S
  W --> P
  P --> S
```

The shared service can supply reusable components and advice; each team retains authority over its data, effects, and acceptance.
