# Paper scope and conformance boundary


## Paper and local-extension boundary

Móra et al. (ATAL 1998; LNAI 1555, 1999) was read at formal-representation, desire/intention-formation, revision, and conclusion depth on 2026-09-24. It proposes ELP/WFSX, Event Calculus, abductive feasibility, and preference revision, assumes initially consistent beliefs, and explicitly leaves belief update out of scope. Any observation ingestion, belief-update adapter, event delivery, threshold, scheduling, or effect path below is a local extension that needs its own typed inputs, failure handling, measurements, and authorization boundary.

**Primary source:** M. C. Móra, J. G. Lopes, R. M. Viccari, and H. Coelho, “BDI Models and Systems: Reducing the Gap,” ATAL 1998; LNAI 1555, published 1999, DOI https://doi.org/10.1007/3-540-49057-4_2. **Accessed:** 2026-09-24. **Access depth:** author-uploaded full text read; publisher DOI identity checked. The paper proposes ELP with explicit negation/WFSX, Event Calculus with event identifiers/duration, abductive feasibility, and preference relations. It assumes initially consistent beliefs and explicitly leaves belief update out of scope.

```mermaid
flowchart LR
    Evidence[Scoped positive or explicit-negative evidence] --> Semantics[Paper-defined ELP/WFSX inference]
    Semantics --> Feasibility[Abductive intention-feasibility check]
    Feasibility --> Revision[Preference-governed revision]
    Revision --> Intention[Chosen intention set]
    Evidence --> Boundary[Local observation-update boundary]
    Boundary -->|not paper-defined| Review[Specify and test separately]
```

```mermaid
flowchart TD
    Vector[Golden test vector] --> Facts[Facts with source and time]
    Facts --> Query{Entailed, explicitly negated, or neither?}
    Query --> Expected[Expected derivation and non-derivation]
    Expected --> Runner[Local interpreter]
    Runner --> Compare{Matches expected?}
    Compare -->|yes| Receipt[Conformance receipt]
    Compare -->|no| Diagnose[Separate paper semantics from local extension]
```

Example vector: `available(port, sourceA, t1)` and `not_available(port, sourceB, t2)` may coexist as scoped evidence. A local authorization policy must not infer physical permission from either statement without authority and freshness checks. This is an engineering boundary, not a claim that the paper supplies authorization.
