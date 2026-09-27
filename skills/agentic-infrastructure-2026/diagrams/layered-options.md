# Layered system options

A workload can be handled by a deterministic process, one model call, a framework, or a multi-agent design. Product boundaries vary; record the implementation owner for each capability.

```mermaid
flowchart TD
  W[Workload and effect contract] --> H[Harness or orchestrator]
  W --> R[Runtime and lifecycle]
  W --> M[Model and provider]
  W --> P[Protocol and adapters]
  W --> A[Application policy]
  H --> R
  H --> M
  H --> P
  P --> A
  R --> A
  A --> E[Effect decision and receipt]
  D[Deterministic or human baseline] -. compare against .-> H
  B[Capability evidence] --> Q[Workload-specific test]
  Q --> A
```

The arrows show responsibilities to examine, not a required topology or proof of enforcement. A protocol such as MCP does not itself supply the application policy or safe effect boundary.

## Workload complexity candidates

This converts the three original composition sketches into topology choices expressed by task need rather than vendor labels.

```mermaid
flowchart TD
  W[Workload requirements] --> Q{What behavior is required?}
  Q -->|One bounded request| S[Single program or model call]
  Q -->|Conditional steps or recovery| G[Explicit workflow or graph]
  Q -->|Independent work and handoffs| T[Multi-worker coordination]
  S --> E[Compare against current process]
  G --> E
  T --> E
  E --> V[Evaluate same tasks, effects, recovery, and cost]
```

The branches are candidates, not maturity levels: choose the least complex option that meets observed requirements.
