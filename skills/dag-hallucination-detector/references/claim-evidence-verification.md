# Claim Evidence Verification

[FEVER: a Large-scale Dataset for Fact Extraction and VERification](https://aclanthology.org/N18-1074/)
uses `Supported`, `Refuted`, and `NotEnoughInfo` labels and requires evidence
for supported or refuted claims. **Access depth:** the ACL Anthology paper record
and abstract were inspected. This is a useful claim/evidence protocol, not a
guarantee that its Wikipedia benchmark or baseline applies to arbitrary web,
private, or changing sources.

```mermaid
flowchart TD
 A[Atomic claim] --> B[Identify source and access depth]
 B --> C[Open passage or metadata]
 C --> D{Relation to claim?}
 D -->|Entails| E[Supported with span]
 D -->|Contradicts| F[Refuted with span]
 D -->|Insufficient or ambiguous| G[NotEnoughInfo]
```
```mermaid
flowchart LR
 A[URL or citation] --> B[Identity metadata]
 B --> C[Abstract]
 C --> D[Full text passage]
 D --> E[Claim-level evidence record]
```

HTTP success proves neither claim entailment nor source authority. A 404 may be
moved, private, or transient; record an unavailable access state rather than false.

## Claim record

For each atomic claim, preserve the artifact location; proposition; source
identity and publisher; publication/version date; retrieval time; quoted or
hashed passage; access depth (`metadata`, `abstract`, `full text`, or a bounded
source slice); evidence-set members; entailment/contradiction rationale;
alternative interpretation; and result. For multi-hop claims, record why each
source is necessary.

```mermaid
flowchart TD
    A[URL or citation] --> B{Retrieval succeeds now?}
    B -->|Yes| C[Record access and evaluate passage]
    B -->|No| D[Record unavailable access state]
    C --> E[Do not equate reachability with entailment]
    D --> F[Do not equate failure with fabrication]
```

A result of `NotEnoughInfo` is not a weak synonym for false. It is the correct
outcome when retrieved evidence cannot establish either relation, even if the
claim sounds implausible or a citation is inaccessible.
