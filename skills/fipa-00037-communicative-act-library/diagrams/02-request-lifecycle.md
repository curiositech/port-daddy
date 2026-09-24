# Request disposition branches

```mermaid
stateDiagram-v2
    [*] --> sent
    sent --> agreed: agree observed, branch A
    sent --> completion_report: completion inform without prior observed agree
    sent --> failure_report: failure without prior observed agree
    sent --> refused: refuse observed, terminal response
    sent --> misunderstood: not-understood observed, terminal response
    sent --> unresolved: no response by local deadline
    agreed --> completion_report: later inform reports completion
    agreed --> failure_report: failure observed
    agreed --> unresolved: no later report by local deadline
    completion_report --> effect_checked: application evidence check
    completion_report --> unresolved: effect cannot be checked
    refused --> [*]
    misunderstood --> [*]
    failure_report --> [*]
    effect_checked --> [*]
    unresolved --> [*]
```

`agree` and `refuse` are alternative observed branches. `unresolved` is a local policy state, not a FIPA-defined terminal state; a completion report remains distinct from checked effect evidence.

This is a constructed application observation graph, not a complete FIPA Request interaction protocol. A prior observed `agree` is optional in this graph; the allowed wire protocol must be named separately. A failure report does not establish absence of partial external effects.
