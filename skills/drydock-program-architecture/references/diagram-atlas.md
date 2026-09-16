# Drydock Diagram and Proof Atlas

This atlas contains every decision-relevant view needed by the current Drydock
program. It intentionally does not force every Mermaid grammar into the bundle:
a decorative pie chart or timeline would add ink without proving a relationship.

For each diagram, record the exact component versions and evidence witnesses when
using it in a real packet. These are architecture models, not runtime receipts.

## Coverage map

| View | Use when | Primary question |
|---|---|---|
| 1. Program context | Explaining the whole product | Who acts, controls, executes, and observes? |
| 2. Trust boundary | Reviewing containment | What remains outside the adversary? |
| 3. Authority split | Detecting circular trust | Who may request, authorize, execute, witness, and project? |
| 4. Source provenance | Protecting main and inputs | How does exact source become guest input and reviewed output? |
| 5. Durable data model | Designing storage | Which identities and records have one-to-many relationships? |
| 6. Lifecycle state machine | Implementing controller transitions | What are all legal body states and terminal failures? |
| 7. Cold birth | Testing start races | What happens before a body may act? |
| 8. Resurrection | Switching bodies/backends | How is old authority fenced and new authority proved? |
| 9. Crash-storm breaker | Preventing spawn loops | Where are retries globally bounded and persisted? |
| 10. Effect reservation | Bounding external effects | How do reserve, dispatch, uncertainty, and settlement differ? |
| 11. Capacity route | Using subscriptions honestly | What happens when native allowance evidence is stale or low? |
| 12. Context lifecycle | Compacting before walls | When do we checkpoint, hibernate, or rebody? |
| 13. Capability compilation | Moving between backends | Which tools and permissions transfer, narrow, or block? |
| 14. Receipt chain | Auditing claims | How do witness-class records become tamper-evident evidence? |
| 15. Operator journey | Designing pd-console/FleetBar/iOS | Can a human start, inspect, intervene, and resume? |
| 16. Implementation DAG | Sequencing work | What must land before dynamic authority? |
| 17. Promotion ladder | Reviewing release claims | Which evidence grants the next exact tier? |

## 1. Program context

**Proves visually:** product roles and direction of proposed control/evidence flow.

**Does not prove:** authentication, containment, persistence, or implementation.

```mermaid
flowchart TB
    Operator([Operator])
    Console["pd-console and FleetBar"]
    Mobile["Secure iOS client"]
    Relay["Relay projection"]

    subgraph Host["Host authority"]
        Verifier["One-use command verifier"]
        Controller["Drydock controller"]
        Lifecycle[("Lifecycle ledger")]
        Capacity["Capacity broker"]
        Effects["Effect broker"]
        Cognition["Cognition compilers"]
        Reaper["Independent reaper"]
        Evidence[("External evidence log")]
    end

    subgraph Guest["Disposable guest"]
        Driver["Trial Basin driver"]
        Subject["Port Daddy subject"]
        Body["Replaceable agent body"]
        Workspace[("Read-only source and disposable worktree")]
    end

    Operator --> Console
    Operator --> Mobile
    Console --> Verifier
    Mobile --> Relay
    Relay --> Verifier
    Verifier --> Controller
    Controller --> Lifecycle
    Controller --> Capacity
    Controller --> Cognition
    Controller --> Driver
    Controller --> Reaper
    Driver --> Subject
    Workspace --> Subject
    Cognition --> Body
    Subject --> Body
    Body --> Effects
    Effects --> Capacity
    Controller --> Evidence
    Lifecycle --> Evidence
    Capacity --> Evidence
    Effects --> Evidence
    Reaper --> Evidence
    Evidence -.-> Console
    Evidence -.-> Relay
```

## 2. Trust boundary and channel absence

**Proves visually:** keys, policy, ledger, kill, and verdict remain outside the
guest; guest channels are enumerated.

**Does not prove:** the hypervisor or device configuration actually matches.

```mermaid
flowchart LR
    subgraph Trusted["Trusted host boundary"]
        Policy["Signed policy and halt"]
        VMControl["VM lifecycle and device inventory"]
        SecretStore["Credential custody"]
        Broker["Typed broker endpoint"]
        Kill["Out-of-band stop and reap"]
        Verdict["Host verdict writer"]
    end

    subgraph Untrusted["Untrusted disposable guest"]
        Agent["Agent and tools"]
        Runtime["Port Daddy build"]
        Tests["Submitted tests and setup"]
        Overlay[("Disposable overlay")]
    end

    Policy --> VMControl
    VMControl -->|"creates with empty device baseline"| Untrusted
    Agent -->|"framed effect request"| Broker
    Broker -->|"bounded result"| Agent
    SecretStore --> Broker
    Kill -->|"host VM handle"| Untrusted
    Untrusted -.->|"bounded evidence channel"| Verdict
```

Required absence claims: no shared home, canonical checkout, host `.git`, raw
credential, ambient Unix socket, general network device, production remote, or
unbounded output channel.

## 3. Consequence-separated authority

**Proves visually:** no one role owns the whole consequential transition.

**Does not prove:** the implementation has prevented confused-deputy paths.

```mermaid
flowchart LR
    Requester["Operator or scheduler proposes"]
    Verifier["Verifier authenticates and scopes"]
    Admission["Admission writer reserves"]
    Launcher["Controller provisions"]
    Executor["Body executes"]
    Broker["Broker mediates effects"]
    Witness["Independent host witnesses"]
    Judge["Gate evaluates evidence"]
    Projection["Console projects result"]

    Requester --> Verifier
    Verifier --> Admission
    Admission --> Launcher
    Launcher --> Executor
    Executor --> Broker
    Launcher --> Witness
    Broker --> Witness
    Witness --> Judge
    Judge --> Projection
    Projection -.-> Requester
```

## 4. Immutable source and worktree provenance

**Proves visually:** main is not an authoring or guest input path; output returns
through quarantine and a separate review worktree.

**Does not prove:** remote authenticity or tree equality without digest receipts.

```mermaid
flowchart LR
    Remote["Verified repository remote"]
    Commit["Exact commit and tree"]
    Vault[("Read-only source vault")]
    ReviewWT["Fresh linked review worktree"]
    Canonical["Canonical main checkout\nclean read-only projection"]
    Bundle["Sealed guest source bundle"]
    GuestWT["Guest disposable worktree"]
    Quarantine["Output quarantine"]
    Human["Review and validation"]
    PR["Non-default branch and PR"]

    Remote --> Commit
    Commit --> Vault
    Vault --> ReviewWT
    Vault --> Bundle
    Bundle --> GuestWT
    GuestWT --> Quarantine
    Quarantine --> Human
    Human --> PR
    Remote -.-> Canonical
    Canonical -.->|"never packaged or mounted"| Bundle
```

## 5. Durable identity and receipt data model

**Proves visually:** one durable actor may have many runs and body generations,
while capabilities and effects attach to a specific admitted generation.

**Does not prove:** transactional constraints; encode those in schema and tests.

```mermaid
erDiagram
    AGENT_NODE ||--o{ RUN : owns
    RUN ||--o{ BODY_LEASE : embodies
    BODY_LEASE ||--o{ PROCESS_WITNESS : observed_by
    BODY_LEASE ||--o{ BACKEND_SESSION : binds
    BODY_LEASE ||--o{ HEARTBEAT : emits
    RUN ||--o{ CAPACITY_RESERVATION : reserves
    RUN ||--o{ CAPABILITY_TICKET : grants
    CAPABILITY_TICKET ||--o{ EFFECT_ATTEMPT : authorizes
    EFFECT_ATTEMPT ||--o{ RECEIPT : evidenced_by
    BODY_LEASE ||--o{ CAPSULE : checkpoints
    CAPSULE ||--o{ ARTIFACT_REF : cites
    RUN ||--o{ BREAKER_EVENT : constrained_by

    AGENT_NODE {
      string agent_id PK
      string identity_digest
      string obligation
    }
    RUN {
      string run_id PK
      string work_node_id
      string state
    }
    BODY_LEASE {
      string lease_id PK
      int generation
      string fence_token
      string state
    }
    PROCESS_WITNESS {
      string platform_handle
      int pid
      string start_identity
    }
    CAPACITY_RESERVATION {
      string native_unit
      int reserved_amount
      string reset_window
    }
    EFFECT_ATTEMPT {
      string idempotency_key
      string state
      string request_digest
    }
    RECEIPT {
      string witness_class
      string event_digest
      string chain_parent
    }
```

## 6. Body lifecycle state machine

**Proves visually:** legal state transitions include birth failure, unknown start,
quarantine, hibernation, and reconciliation rather than optimistic RUNNING.

**Does not prove:** liveness or atomic storage.

```mermaid
stateDiagram-v2
    state StartVerdict <<choice>>
    state LossVerdict <<choice>>

    [*] --> Unembodied
    Unembodied --> Reserved: admission commits
    Reserved --> Provisioning: launch owner claims
    Provisioning --> StartVerdict: witness or deadline
    StartVerdict --> Handshaking: exact body observed
    StartVerdict --> BirthFailed: absence proved
    StartVerdict --> StartUnknown: platform result ambiguous
    Handshaking --> Running: identity and sinks verified
    Handshaking --> BirthFailed: challenge fails
    StartUnknown --> ReconciliationRequired: handle recovered
    StartUnknown --> Quarantined: platform unavailable
    Running --> Checkpointing: pressure or pause
    Checkpointing --> Running: checkpoint accepted
    Checkpointing --> Hibernated: body stopped
    Running --> Stopping: stop requested
    Stopping --> Hibernated: absence proved
    Stopping --> Quarantined: teardown unresolved
    Running --> LossVerdict: liveness lost
    LossVerdict --> Running: same body re-witnessed
    LossVerdict --> ReconciliationRequired: body absent
    LossVerdict --> Quarantined: evidence conflicts
    ReconciliationRequired --> ResurrectionPending: fence and effects clear
    Hibernated --> ResurrectionPending: continuation requested
    ResurrectionPending --> Reserved: generation increments
    Running --> Completed: accepted terminal receipt
    Running --> Failed: terminal failure receipt
    BirthFailed --> Unembodied: attempt settled
    Completed --> [*]
    Failed --> [*]
```

## 7. Cold birth sequence

**Proves visually:** reservation and durable intent precede VM/process creation;
RUNNING follows an external challenge.

**Does not prove:** API idempotency or crash consistency without negative tests.

```mermaid
sequenceDiagram
    actor Operator
    participant UI as Operator Surface
    participant V as Command Verifier
    participant A as Admission Writer
    participant C as Controller
    participant P as Capacity Broker
    participant H as Hypervisor Adapter
    participant B as Body
    participant L as Evidence Log

    Operator->>UI: Start one bounded worker
    UI->>V: Signed one-use command
    V->>A: Verified scope and nonce
    A->>P: Reserve native capacity and concurrency
    P-->>A: Reservation or denial receipt
    A->>A: Commit run and body generation
    A->>C: Launch lease with exact digests
    C->>H: Create disposable guest
    H-->>C: VM and process handle
    C->>B: Deliver capsule and capability manifest
    B-->>C: Challenge response and sink proof
    C->>A: Compare-and-swap HANDSHAKING to RUNNING
    C->>L: Host witness and transition receipts
    A-->>UI: Typed RUNNING projection
```

## 8. Resurrection and backend switch

**Proves visually:** predecessor fencing, effect reconciliation, capsule proof,
fresh capacity, and capability translation all precede successor authority.

**Does not prove:** semantic equivalence across models; that needs fixtures and
adversarial evaluation.

```mermaid
sequenceDiagram
    participant W as Watchdog
    participant L as Lifecycle Ledger
    participant E as Effect Broker
    participant X as Context Steward
    participant K as Capability Compiler
    participant P as Capacity Broker
    participant C as Controller
    participant N as New Body
    participant R as Receipt Log

    W->>L: Body generation n is missing or threatened
    L->>L: Fence generation n
    L->>E: Reconcile every dispatched effect
    E-->>L: Settled or ambiguous
    alt effect remains ambiguous
        L->>R: QUARANTINED receipt
    else effects reconciled
        L->>X: Seal cited capsule and worktree evidence
        X-->>L: Verified capsule digest
        L->>P: Reserve destination capacity
        P-->>L: Reservation
        L->>K: Compile destination phase capabilities
        K-->>L: Translation report
        L->>C: Commit generation n plus 1 lease
        C->>N: Provision with capsule and manifest
        N-->>C: Capsule challenge response
        C->>L: Successor witness
        L->>R: RUNNING generation n plus 1 receipt
    end
```

## 9. Crash-storm and spawn breaker

**Proves visually:** retry decisions are durable, scoped, and outside the failed
body; delay does not replace a hard cap.

**Does not prove:** chosen thresholds are appropriate without workload evidence.

```mermaid
stateDiagram-v2
    [*] --> ClosedOnBoot
    ClosedOnBoot --> Reconciling: controller starts
    Reconciling --> Open: all nonterminal bodies classified
    Reconciling --> Tripped: orphan or unknown remains
    Open --> Reserved: global and scoped slots available
    Reserved --> Launching: one launch owner commits
    Launching --> Open: body reaches RUNNING
    Launching --> CountingFailure: birth fails
    CountingFailure --> Open: explicit retry owner and budget remain
    CountingFailure --> Tripped: any hard threshold reached
    Tripped --> AwaitingReview: cooldown never clears authority alone
    AwaitingReview --> Reconciling: authorized reset receipt
    Reserved --> Tripped: reservation expires ambiguously
```

Scopes include global, operator, repository, project, provider, AgentNode,
work-node digest, parent ancestry, and time window. Persist all counters and
generation attempts.

## 10. Effect and spend reservation

**Proves visually:** reservation, dispatch, uncertainty, and settlement have
different refund rules.

**Does not prove:** provider-enforced financial custody.

```mermaid
stateDiagram-v2
    state "EXPIRED AND REFUNDED" as Expired
    state "SETTLED WITH REMAINDER" as Settled

    [*] --> Proposed
    Proposed --> Reserved: capability and ceilings valid
    Proposed --> Denied: unknown input or stale policy
    Reserved --> Expired: dispatch lease expires unused
    Reserved --> Dispatched: broker begins operation
    Dispatched --> Settled: provider usage reconciled
    Dispatched --> Uncertain: response or settlement lost
    Uncertain --> Settled: observed or conservatively charged
    Uncertain --> Quarantined: reconciliation unavailable
    Denied --> [*]
    Expired --> [*]
    Settled --> [*]
```

## 11. Capacity-aware route selection

**Proves visually:** subscription-backed work needs fresh native-unit evidence and
checkpoint reserve; cash and subscriptions take different paths.

**Does not prove:** remaining allowance when the provider exposes no measurement.

```mermaid
flowchart TD
    Intent["Bounded work intent"] --> Need["Estimate atomic action plus checkpoint tail"]
    Need --> Route{"Economic route"}
    Route -->|"Fake or replay"| Zero["Reserve compute, time, bodies, and output only"]
    Route -->|"Billable API"| Cash{"Provider-side cash custody proved"}
    Route -->|"Subscription"| Observe{"Fresh native allowance observed"}
    Cash -->|"No"| Deny["Deny real dispatch"]
    Cash -->|"Yes"| CashReserve["Reserve worst-case cash exposure"]
    Observe -->|"No or unknown"| Deny
    Observe -->|"Yes"| Fit{"Forecast fits allowance minus reserve"}
    Fit -->|"No"| Compact["Checkpoint, compact, hibernate, or choose smaller route"]
    Fit -->|"Yes"| NativeReserve["Reserve native units and reset window"]
    Zero --> Admit["Admission proposal"]
    CashReserve --> Admit
    NativeReserve --> Admit
    Compact --> Need
```

## 12. Context pressure and capsule lifecycle

**Proves visually:** compaction and rebodiment happen at safe boundaries and are
gated by capsule verification.

**Does not prove:** summary fidelity without citation and challenge fixtures.

```mermaid
stateDiagram-v2
    state Boundary <<choice>>
    state Destination <<choice>>

    [*] --> Working
    Working --> PressureRising: forecast crosses soft threshold
    PressureRising --> Working: capacity recovers
    PressureRising --> Boundary: hard wall predicted
    Boundary --> CheckpointRequired: atomic action can finish
    Boundary --> EmergencyCheckpoint: wall arrives early
    CheckpointRequired --> CapsuleBuilding: freeze new effects
    EmergencyCheckpoint --> CapsuleBuilding: preserve complete tool pairs
    CapsuleBuilding --> CapsuleVerifying: cite plan diff effects and evidence
    CapsuleVerifying --> Switchable: coverage and integrity pass
    CapsuleVerifying --> Quarantined: omission or ambiguity
    Switchable --> Destination: select continuation
    Destination --> Working: same-body compaction
    Destination --> Hibernated: wait for reset or operator
    Destination --> Translating: new backend or model
    Translating --> SuccessorProving: capability report complete
    SuccessorProving --> Working: challenge passes
    SuccessorProving --> Quarantined: challenge fails
    Quarantined --> CapsuleBuilding: evidence repaired
    Working --> Completed: obligation settles
```

## 13. Capability compilation

**Proves visually:** capability translation begins from required semantics and
can narrow or block; it does not copy ambient tool catalogs.

**Does not prove:** equivalent tools behave equivalently without conformance
fixtures.

```mermaid
flowchart LR
    Node["Exact work-node requirements"]
    Policy["Operator and repository policy"]
    Adapter["Destination backend profile"]
    Registry["Versioned tools, MCPs, skills, hooks, prompts"]
    Compiler["Capability compiler"]
    Exact["EXACT"]
    Equivalent["EQUIVALENT"]
    Narrowed["NARROWED"]
    Omitted["OMITTED"]
    Blocked["BLOCKED"]
    Pack["Phase-scoped capability pack"]
    Ticket["Lease-bound effect tickets"]

    Node --> Compiler
    Policy --> Compiler
    Adapter --> Compiler
    Registry --> Compiler
    Compiler --> Exact
    Compiler --> Equivalent
    Compiler --> Narrowed
    Compiler --> Omitted
    Compiler --> Blocked
    Exact --> Pack
    Equivalent --> Pack
    Narrowed --> Pack
    Omitted -.-> Pack
    Pack --> Ticket
    Blocked -->|"required semantic missing"| Denial["No successor authority"]
```

## 14. External receipt and Merkle evidence chain

**Proves visually:** observations are append-only, content-addressed, and anchored
outside guest-writable state.

**Does not prove:** a witness told the truth; witness class and collection
position remain part of every claim.

```mermaid
flowchart LR
    HostEvent["Host-observed event"]
    BrokerEvent["Broker-observed event"]
    GuestEvent["Guest-asserted event"]
    Normalize["Canonical typed envelope"]
    LeafA["Digest leaf A"]
    LeafB["Digest leaf B"]
    LeafC["Digest leaf C"]
    Parent["Merkle parent"]
    Root["Run evidence root"]
    Anchor["External append-only anchor"]
    Manifest["Artifact and replay manifest"]
    Viewer["Two-action evidence zoom"]

    HostEvent --> Normalize
    BrokerEvent --> Normalize
    GuestEvent --> Normalize
    Normalize --> LeafA
    Normalize --> LeafB
    Normalize --> LeafC
    LeafA --> Parent
    LeafB --> Parent
    Parent --> Root
    LeafC --> Root
    Root --> Anchor
    Root --> Manifest
    Anchor --> Viewer
    Manifest --> Viewer
```

## 15. Operator journey

**Proves visually:** the intended control path keeps denial, intervention,
inspection, and continuation visible to a non-terminal operator.

**Does not prove:** usability until the actual product UI is rendered and tested.

```mermaid
journey
    title One bounded worker from intent to reviewed continuation
    section Muster
      Choose repository and see capacity: 5: Operator
      Inspect active and stale bodies: 5: Operator
    section Shape
      Describe ad hoc or roadmap work: 5: Operator
      Review plan, tier, tools, and limits: 4: Operator
      Resolve explicit denial if needed: 3: Operator
    section Work
      Start one admitted body: 5: Operator
      Watch calm live presence and current evidence: 4: Operator
      Open chat, diff, test, claim, or receipt: 5: Operator
    section Intervene
      Pause, stop, cancel, or answer HITL: 5: Operator
      Review capacity pressure and safe boundary: 4: Operator
    section Continue
      Inspect capsule and capability translation: 4: Operator
      Resume same body or approve new backend: 5: Operator
      Join securely from iOS when away: 4: Operator
    section Review
      Inspect quarantined artifact and PR proof: 5: Operator
      Accept, repair, or reject exact evidence: 5: Operator
```

## 16. Implementation dependency DAG

**Proves visually:** dynamic execution and provider canaries are downstream of
contracts, durable accounting, capacity, breakers, and fake deterministic proof.

**Does not prove:** the machine-readable hypertree is valid; run its validator.

```mermaid
flowchart LR
    D0["D0 Contracts, schemas, threats"] --> D1["D1 Inert transition core"]
    D0 --> D2["D2 Fake capacity and effect brokers"]
    D0 --> D3["D3 Hostile fixture library"]
    D1 --> D4["D4 Durable lifecycle ledger"]
    D2 --> D4
    D4 --> D5["D5 Global spawn breakers and reaper"]
    D1 --> D6["D6 Capsule and context state machine"]
    D2 --> D6
    D6 --> D7["D7 Capability compiler"]
    D5 --> D8["D8 Inert resurrection saga"]
    D7 --> D8
    D3 --> D9["D9 Deterministic Trial Basin"]
    D8 --> D9
    D9 --> Gate1{"Static and fake gates pass"}
    Gate1 -->|"No"| Repair["Repair the owning contract"]
    Repair --> D1
    Gate1 -->|"Yes"| D10["D10 No-network VM adapter"]
    D10 --> D11["D11 Port Daddy guest and test routing"]
    D11 --> Gate2{"Exact provider canary approved"}
    Gate2 -->|"No"| Hold["Remain zero-provider"]
    Gate2 -->|"Yes"| D12["D12 One T3A or T3B canary"]
    D12 --> D13["D13 Fixture worker"]
    D13 --> D14["D14 Crew and federation research"]
```

## 17. Exact-tier promotion ladder

**Proves visually:** authority increases only after evidence and a new operator
grant; no test tier silently promotes itself.

**Does not prove:** any rung has passed for a particular build.

```mermaid
flowchart TB
    T0["T0 Static contracts"] --> G1{"New grant plus schema and source proof"}
    G1 --> T1["T1 Fake deterministic guest"]
    T1 --> G2{"Replayable host and broker receipts"}
    G2 --> T2["T2 Recorded replay guest"]
    T2 --> G3{"Separate provider custody or native capacity proof"}
    G3 --> T3A["T3A One billable canary"]
    G3 --> T3B["T3B One subscription canary"]
    T3A --> G4{"New fixture-worker grant"}
    T3B --> G4
    G4 --> T4["T4 One quarantined fixture worker"]
    T4 --> G5{"Aggregate conservation and race proof"}
    G5 --> T5["T5 Cooperative crew"]
    T5 --> G6{"Cross-host custody and adversarial proof"}
    G6 --> T6["T6 Federation"]

    G1 -->|"missing"| Blocked["BLOCKED or NOT_PROVISIONED"]
    G2 -->|"missing"| Blocked
    G3 -->|"missing"| Blocked
    G4 -->|"missing"| Blocked
    G5 -->|"missing"| Blocked
    G6 -->|"missing"| Blocked
```

## Selecting and maintaining diagrams

Use the smallest set that covers the claim, but never omit a boundary-changing
view. If a code change adds a state, process, authority, record, channel, or
promotion edge, update the matching diagram and its negative test in the same
slice. If prose and diagram disagree, neither is accepted until reconciled.

For a full integrated architecture packet, include at least views 2, 4, 5, 6,
8, 9, 10, 12, 13, 14, 16, and 17. Product UI work also requires view 15 plus
actual operator-facing captures; the journey chart alone is not pixel evidence.
