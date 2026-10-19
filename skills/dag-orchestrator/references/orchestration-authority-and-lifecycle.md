# Orchestration Authority and Lifecycle

The supplied research did not inspect a primary orchestrator runtime or API.
This is a planning and receipt contract, not evidence that a task tool has these
semantics.

[W3C PROV-O](https://www.w3.org/TR/prov-o/) was opened for entity, activity, and
agent vocabulary. **Access depth:** official vocabulary terms only; it does not
establish runtime scheduling, authorization, or effect completion.

```mermaid
flowchart LR
    A[Task contract] --> B[Graph revision]
    B --> C[Executor authority and attempt receipts]
    C --> D[Join and acceptance evaluator]
    D --> E[Result or escalation]
```

```mermaid
stateDiagram-v2
    [*] --> Proposed
    Proposed --> Admitted: authority and contracts checked
    Admitted --> Running: executor receipt
    Running --> Joining: child outcomes known or reconciled
    Joining --> Complete: acceptance passes
    Joining --> Escalated: unknown effect or unmet condition
```

Record controller identity, graph revision, admitted authority, attempt IDs,
cancellation request/acknowledgement, effect state, join policy, and acceptance
receipt. A lost connection is not proof that an attempt stopped.
