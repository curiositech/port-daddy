# Research message and state-control patterns

## Role-message example

This converts the original analyst/critic dialogue as a bounded workflow. It does not claim that discussion reaches truth or consensus.

```mermaid
sequenceDiagram
  participant U as User
  participant H as Harness
  participant A as Analyst
  participant C as Critic
  U->>H: Submit question and source constraints
  H->>A: Provide task contract
  A-->>H: Return analysis with evidence references
  H->>C: Request rubric-based review
  C-->>H: Return objections and missing evidence
  loop Bounded revision budget remains and issues are unresolved
    H->>A: Send specific objections
    A-->>H: Return revision and evidence
    H->>C: Recheck against the same rubric
    C-->>H: Return remaining issues or no blocking issue found
  end
  H-->>U: Return result, unresolved issues, and evidence limits
```

The harness owns the stopping rule, and unresolved objections remain visible rather than being silently treated as consensus.

## State-control example

```mermaid
stateDiagram-v2
  [*] --> Proposed
  Proposed --> Authorized: authority and scope checked
  Proposed --> Held: missing authority or unclear scope
  Authorized --> Running: begin bounded work
  Running --> Completed: result and receipt recorded
  Running --> Held: failure, deadline, or unknown effect
  Held --> Reconciling: inspect task and effect receipts
  Reconciling --> Completed: required outcome confirmed, record receipt
  Reconciling --> Authorized: absent or idempotent, authority rechecked
  Reconciling --> Held: unresolved, do not retry
  Held --> Abandoned: owner chooses to stop
  Completed --> [*]
  Abandoned --> [*]
```

These are constructed control patterns. A state in `Held` cannot resume merely because authorization was rechecked: unknown effects must first be reconciled, or the retry must use a verified idempotency rule. Unresolved state stays held. The diagrams illustrate decision ownership and stop routes; they do not assert enforcement in a particular framework.

A confirmed charge or other partial effect alone does not complete the task. Completion requires the declared outcome and its evidence; retain held status when those are unresolved.
