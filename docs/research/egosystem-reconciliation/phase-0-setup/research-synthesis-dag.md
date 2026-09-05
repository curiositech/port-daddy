# Research and Synthesis DAG

```mermaid
flowchart TD
    P0[Phase 0: scope, authority, roster, cost, ground rules] --> I[Current-source and primary-source inventory]
    I --> FG[Bounded Field Guide reviewer-persona case]
    FG --> A[Phase 1A: privacy and authority]
    I --> B[Phase 1B: provenance and logic]
    I --> C[Phase 1C: distributed durability]
    I --> D[Phase 1D: governance and incentives]
    I --> E[Phase 1E: operator UX and accessibility]
    I --> F[Phase 1F: product, cost, and delivery]
    A & B & C & D & E & F --> S[Phase 2: principle hierarchy, tension map, skeleton]
    S --> A3[Phase 3A: steel-man and amend]
    S --> B3[Phase 3B: steel-man and amend]
    S --> C3[Phase 3C: steel-man and amend]
    S --> D3[Phase 3D: steel-man and amend]
    S --> E3[Phase 3E: steel-man and amend]
    S --> F3[Phase 3F: steel-man and amend]
    A3 & B3 & C3 & D3 & E3 & F3 --> C4[Phase 4: consolidated soul document and dissent]
    C4 --> PM[Phase 5: fresh product review]
    C4 --> EM[Phase 5: fresh engineering review]
    C4 --> DX[Phase 5: fresh design review]
    PM & EM & DX --> M[Phase 6: final merge]
    M --> CON[Constitution and practitioner guide]
    M --> ARC[Data, API, ACL, lifecycle, detector, and rollout architecture]
    M --> VIS[Impact-preview static visual artifacts]
    M --> SK[Reusable reconciliation skill]
    M --> RP[Research protocol: H1-H4 and human-attention utility]
    CON & ARC & VIS & SK & RP --> V[Validation, dissent audit, exact-main reconciliation]
    V --> PUB[Governed publisher handoff or published review slices]
```

## Phase gates

| Gate | Required evidence |
| --- | --- |
| P0 | scope, non-goals, six distinct positions, fresh-eyes quarantine, cost cap, roadmap anchor |
| P1 | six independent papers, each with principles, tensions, concrete structure, and ranked priorities |
| P2 | every paper represented; convergence tiers; explicit tension classification; structural skeleton |
| P3 | six steel-man sections; specific amendments; fundamental dissent flagged |
| P4 | every amendment accepted or rejected with reasons; coherent document; dissent and scope preserved |
| P5 | PM, engineering, and design verdicts with P0/P1 demands; no prior-process contamination |
| P6 | every P0/P1 demand addressed or explicitly rejected; final outputs stand alone |
| Publish | citations valid; accessibility and artifact checks pass; skill validates; current-main and ownership rechecked; governed identity available |

## Experimental sub-DAG

```mermaid
flowchart LR
    C[Longitudinal project corpus] --> B[Baseline: shared retrieval memory]
    C --> T1[Treatment: institutional epistemic state]
    C --> T2[Treatment: consequence closure]
    C --> T3[Ablation: shared vs isolated vs controlled disclosure]
    C --> T4[Ablation: ordinary vs evidence-grounded memory]
    B & T1 & T2 & T3 & T4 --> M[Blind scoring]
    M --> R[Contradiction, provenance, temporal, collision, diversity, correction metrics]
    R --> U[Human-attention and compute-adjusted utility]
    U --> F[Replication package and falsification report]
```

## Dependency and ownership boundary

This research is a specification child of `chartroom-grand-harbor-authority-cutover`. It depends on the existing remote append-only authority, provider-neutral retrieval fabric, authenticated resource scopes, durable AgentNode roles, Porthole evidence contracts, and governed Fleetbot publication. It owns only the new research, visual concept, and skill artifacts named in the process log. It does not own those dependencies or change their roadmap projections.
