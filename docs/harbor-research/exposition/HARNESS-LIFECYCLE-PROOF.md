# Harness Lifecycle Proof

> Provenance: written by an agent during the night the author describes as the one time the product ran turnkey (agents coding, messaging each other, a fleet agent driving diffs to merge), and preserved here verbatim on 2026-09-07 because the book owes it a section. Component names have changed since; the vocabulary (Genesis, Voyage, Wake, Logbook, Receipt) and the invariant at the end are what the book takes. The substrate study in `studies/substrate-study/PROTOCOL.md` is a Dream Rig in this sense: each cell is a Genesis, each seeded run a Voyage, the CSV the Logbook, `REPORT.md` the Receipt.

```mermaid
flowchart TD
    A[Agent begins work] --> B[Restore intent, plan, claims, salvage state]
    B --> C[Bounded guidance enters model context]
    C --> D[Agent acts]

    D --> E[Tool / repo / PR / peer event]
    E --> F{What changed?}

    F -->|Normal result| G[Capture evidence and update shared state]
    F -->|Oversized output| H[Spill full bytes]
    F -->|Coordination conflict| I[Open or join Parley]
    F -->|Context pressure| J[Checkpoint plan]
    F -->|External change| K[Digest and inject bounded notification]

    H --> H1[Preview + pointer]
    H1 --> H2[Page / search / drill]
    H2 --> G

    I --> I1[Natural agent dialogue]
    I1 --> I2[Settlement]
    I2 --> I3[ParleySettlement receipt]
    I3 --> G

    J --> J1[Build ContextEnvelope]
    J1 --> J2[Build cited CompactionPacket]
    J2 --> J3[Preserve tool-call/result pairs]
    J3 --> J4[Old body ends]
    J4 --> J5[New body / model resumes]
    J5 --> J6[Read plan + packet first]
    J6 --> D

    K --> G
    G --> L{Work complete?}

    L -->|No| C
    L -->|Yes| M[Final checkpoint]
    M --> N[Release claims and authority]
    N --> O[Archive evidence]
    O --> P[Produce WorkReceipt]
    P --> Q[Later agent can reconstruct what happened and why]
```

## The proof model

Every meaningful lifecycle transition should prove four linked facts:

```mermaid
flowchart LR
    S[Stimulus<br/>What happened?]
    --> P[Perception<br/>What did Port Daddy observe and inject?]
    --> A[Action<br/>What did the agent or harness do?]
    --> E[Evidence<br/>What durable artifact proves it?]
```

A context-compaction scenario, for example, is not:

> “Run the compaction command and show that it exits successfully.”

It is:

```mermaid
sequenceDiagram
    participant W as Dream Rig
    participant A1 as Agent Body A
    participant PD as Port Daddy
    participant BS as Blob / Evidence Store
    participant A2 as Agent Body B
    participant P as Porthole

    W->>A1: Give task + controlled large workload
    A1->>PD: Execute tools
    PD->>PD: Measure context pressure: 74%
    A1->>PD: Run very large test/log-producing command
    PD->>BS: Spill oversized output
    BS-->>PD: BufferedOutputRef
    PD-->>A1: Bounded preview + searchable pointer

    PD->>PD: Context pressure: 86%
    PD-->>A1: Plan checkpoint required
    A1->>PD: Update pd plan

    PD->>PD: PreCompact
    PD->>BS: Store cited ContextEnvelope
    PD->>BS: Store CompactionPacket
    Note over PD,BS: Tool calls remain paired with their results

    A1--xA1: Body ends

    PD->>A2: Resume from plan + packet
    Note over A2: No giant transcript replay
    A2->>PD: Continue intended work correctly

    PD->>BS: Final WorkReceipt

    P->>PD: Observe lifecycle events
    P->>BS: Verify evidence references
    P-->>W: Render the actual causal chain
```

# What Porthole is recording

Porthole should not primarily record terminals.

It should record **causality**.

For every important event, the viewer should be able to answer:

- What condition existed before the harness intervened?
- What did Port Daddy know?
- What did Port Daddy actually put in front of the model?
- Which authority permitted or blocked the next action?
- What did the agent do because of it?
- What state changed?
- What evidence survived?
- Could another agent resume from that evidence?
- Can the result later be challenged or replayed?

That means the real unit of Porthole footage is not a command invocation.

It is a **provable transition**.

```mermaid
flowchart LR
    BEFORE[Before-state]
    --> STIM[Stimulus]
    --> OBS[Harness observation]
    --> DECIDE[Governed decision]
    --> ACT[Agent action]
    --> AFTER[After-state]
    --> RECEIPT[Receipt]
```

The movie is merely the human-readable projection of that transition.

The receipt is its machine-readable projection.

## Dream Rig, Port Daddy, and Porthole

These three should remain deliberately separate.

```mermaid
flowchart TD
    DR["DREAM RIG<br/><br/>Scenario Genesis<br/>Creates controlled worlds"]
    PD["PORT DADDY<br/><br/>Governance Runtime<br/>Coordinates agents inside them"]
    PH["PORTHOLE<br/><br/>Witness / Instrumentation<br/>Observes what actually happened"]
    WR["WORK RECEIPT<br/><br/>Adjudicable durable evidence"]

    DR -->|repo, agents, failures,<br/>PRs, collisions, logs,<br/>context pressure| PD
    PD -->|real lifecycle behavior| PH
    PD -->|authority + state evidence| WR
    PH -->|observational evidence| WR
```

Dream Rig must be able to say:

> Create a repo with two agents whose intended edits overlap semantically but not textually. Give one an incoming PR review after three turns. Make the second tool output exceed the context-safe boundary. Drive Agent A above the PreCompact threshold.

Then Port Daddy gets no special favors. It has to deal with that world.

Porthole watches.

The receipt tells us whether it actually succeeded.

# The experimental loop

This is where the architecture becomes more than a demo harness.

```mermaid
flowchart TD
    H[Hypothesis]
    --> G[Genesis<br/>Controlled scenario]
    --> R[Run<br/>Real agents + real harness]
    --> O[Observation<br/>Porthole]
    --> A[Adjudication<br/>Tests + Fleet + receipts]
    --> L[Learning<br/>What worked and failed?]
    --> C[Change harness / policy / skill]
    --> H2[New hypothesis]

    H2 --> G
```

The same Genesis can be replayed against different harness conditions:

```mermaid
flowchart LR
    G[Same Genesis]
    --> A[Naked model]
    G --> B[+ Output protection]
    G --> C[+ Continuity]
    G --> D[+ Parley]
    G --> E[Full Port Daddy]
    G --> F[Different model / provider]

    A --> M[Compare outcomes]
    B --> M
    C --> M
    D --> M
    E --> M
    F --> M
```

Now Port Daddy can answer questions experimentally:

- Does compaction reduce task failure?
- Does Parley reduce duplicate work?
- Does bounded suggestion improve completion without creating distraction?
- Does a plan checkpoint improve cross-model resurrection?
- Does the full harness outperform a naked model enough to justify its token and latency costs?
- Which interventions help only under particular failure modes?
- Which skills improve behavior versus merely changing traces?

That is the system worth recording.

# What should this “Genesis” be called?

I would use **Genesis** for the instantiated test-world itself, not for the entire discipline.

A useful vocabulary would be:

**Genesis** — a reproducible initial world-state  	` plus perturbation schedule.

**Voyage** — one execution of a Genesis by a particular model/harness configuration.

**Wake** — the observable behavioral trace left by that Voyage.

**Logbook** — the structured observational record.

**Receipt** — the adjudicated claims we are willing to assert afterward.

That gives us a strong naval vocabulary:

```mermaid
flowchart LR
    G[Genesis<br/>the world we create]
    --> V[Voyage<br/>one actual run]
    --> W[Wake<br/>the behavior it leaves]
    --> L[Logbook<br/>structured observations]
    --> R[Receipt<br/>adjudicated result]
```

A Genesis might therefore be something like:

> **Genesis: Contested Checkout**
>
> Two agents receive adjacent checkout work. Their plans collide at one semantic contract. Agent B crosses 85% context pressure while investigating a failing test. A review notification arrives while the Parley is active. Agent A finishes first.

You can run that Genesis twenty times.

Each is a different Voyage.

Each produces its own Wake and Logbook.

Each ends—successfully or unsuccessfully—with a Receipt.

# The larger discipline

For the overall system, the strongest name is **Harness Experimentalism**.

More technical alternatives are:

- **Agent Lifecycle Experimentation**
- **Harness Adjudication**
- **Behavioral Harness Verification**

The conceptual hierarchy is:

```text
Harness Experimentalism
    └── Genesis
         └── Voyage
              └── Wake
                   └── Logbook
                        └── Receipt
```

The key invariant is:

> **A harness claim is not established because a feature executed. It is established when a controlled Genesis produces an observable Voyage whose consequential transitions are supported by durable evidence and a valid adjudication receipt.**

## The closed loop

This gives Port Daddy a finite experimental loop rather than a write-only evidence system:

```mermaid
flowchart LR
    DESIGN[Design / Hypothesis]
    --> GENESIS[Genesis]
    --> VOYAGE[Voyage]
    --> OBSERVE[Porthole Observation]
    --> ADJUDICATE[Adjudication]
    --> RECEIPT[Receipt]
    --> HARVEST[Harvest findings]
    --> MEMORY[Retrievable evidence + memory]
    --> IMPROVE[Policy / skill / harness improvement]
    --> DESIGN
```

The important final edge is **back into the system**.

Evidence that is recorded but never retrieved is archival exhaust. The useful system records enough of the Voyage to support later retrieval, comparison, counterfactual analysis, skill extraction, regression detection, and policy improvement.

That makes the whole architecture:

**Dream Rig creates the Genesis. Port Daddy governs the Voyage. Porthole witnesses the Wake. The Logbook preserves the observations. Adjudication produces the Receipt. Harvesting feeds what was learned back into the next Genesis.**	