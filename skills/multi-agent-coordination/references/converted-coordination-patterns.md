# Converted Coordination Patterns

Worktrees isolate working directories; they do not automatically serialize external effects or resolve semantic conflicts.

```mermaid
flowchart TB
  A[Coordination: tasks and dependencies] --> B[Isolation: worktrees, claims, locks] --> C[Communication: evidence and events] --> D[Integration: reconcile and test]
  E[Effect authority] -. specified separately .-> B
```
```mermaid
flowchart TD
  R[Repository history] --> W1[Feature worktree]
  R --> W2[Test worktree]
  R --> W3[Documentation worktree]
  W1 --> Q[Dependency-ready integration queue]
  W2 --> Q
  W3 --> Q
  Q --> T[Revalidate at current head]
```
```mermaid
flowchart TD
  A[Choose boundary] --> B{What makes work separable?}
  B -->|Modules| C[Separate components]
  B -->|Shared contract| D[Define contract then parallel consumers]
  B -->|Concern| E[Feature tests docs with handoff]
  B -->|Discovery| F[Scout then allocate]
```
```mermaid
flowchart LR
  A[Conflict detected] --> B{Conflict type}
  B -->|Additive| C[Integrate both with review]
  B -->|Semantic| D[Resolver evaluates choices]
  B -->|Structural| E[Escalate design decision]
  C --> F[Run shared acceptance checks]
  D --> F
```

Compare single-agent, isolated, and coordinated treatments at equal task, model, authority, tests, and resource budget. Measure correctness, regressions, duplicate work, contention, integration time, retries, and coordination cost.
