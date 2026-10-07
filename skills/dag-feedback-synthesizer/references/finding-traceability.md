# Finding Traceability

[W3C PROV-O](https://www.w3.org/TR/prov-o/) supplies vocabulary for entities,
activities, and agents. **Access depth:** the official vocabulary was opened for
those terms. It does not prove a finding, authorize a change, or establish that
an acceptance check was executed.

```mermaid
flowchart LR
 A[Observed finding] --> B[Source pointer and access depth]
 B --> C[Minimal reversible revision]
 C --> D[Acceptance check]
 D --> E[Regression result]
```
```mermaid
stateDiagram-v2
 [*] --> Preserved
 Preserved --> ProposedChange: evidence supports defect
 ProposedChange --> Checked: acceptance test
 Checked --> Preserved: regression or insufficient evidence
 Checked --> Revised: check passes
```

Group findings only when they share a demonstrated root cause. Priorities and
cutoffs are configurable policy, not universal evidence.

## Minimal record

Record `findingId`, observed artifact and location, source pointer, access
depth, claim or requirement, evidence status, proposed reversible change,
preserved material, acceptance check, regression check, and disposition. A
missing source is a missing source; do not replace it with a numeric certainty.

```mermaid
sequenceDiagram
    participant V as Validator or reviewer
    participant F as Finding record
    participant R as Revision author
    participant C as Acceptance check
    V->>F: observation plus location
    F->>R: bounded change and preservation rule
    R->>C: revised artifact
    C-->>F: pass, regression, or insufficient evidence
```
