# Revisioned Mutation and Invalidation

The supplied research did not inspect a primary graph-mutation implementation.
This reference defines a conservative planning contract: graph revisions are
immutable proposals until a separate executor validates and runs them.

```mermaid
flowchart TD
    A[Input, code, config, or policy change] --> B[Compare declared digests]
    B --> C[Affected descendants]
    C --> D[Proposed graph revision]
    D --> E[Validate cycles, contracts, authority, and effects]
    E --> F[Approve, reject, or escalate]
```

```mermaid
stateDiagram-v2
    [*] --> PriorRevision
    PriorRevision --> Proposal: new evidence
    Proposal --> Validated: checks pass
    Proposal --> Rejected: check fails
    Validated --> Executed: separate runner receipt
    Executed --> [*]
    Rejected --> [*]
```

Record the prior revision, mutation rationale, changed digests, affected nodes,
old-output disposition, effect/idempotency policy, acceptance check, and merge
rule. Source access limitation: no primary runtime source was inspected in the
supplied research, so this is not evidence of any executor’s behavior.
