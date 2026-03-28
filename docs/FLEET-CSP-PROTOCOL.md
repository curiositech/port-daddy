# Fleet CSP Protocol Specification

**Version:** 1.0
**Date:** 2026-03-27
**Status:** Draft
**Prerequisite reading:** Hoare (1978), *Communicating Sequential Processes*

## 1. The Fleet as a Process Network

Each fleet agent is a CSP process. Its interface is defined by the channels it
reads from (guards) and the channels it writes to (outputs). The fleet YAML is
a topology declaration -- it defines the communication graph.

```
                              git:committed
                      +---------->  QA  ----------> qa:clean
                      |        +-> Test-Hunter      qa:findings --> [notify-findings watcher]
     Gardener ------->|        +-> Documentarian
     (*/10 * * * *)   |        +-> Simplifier
          |           |        +-> Cartographer
     git:status       |
                      |
                      |
     Spark ------> spark:idea ----> Spider ------> spider:connections
     (*/30m)                        (*/2h)
        ^                              |
        |   reads .spider/connections/ |
        +--------- [file system] ------+
                reads .spark/ideas/
```

### Process Definitions (CSP Notation)

```
GARDENER = *[ tick.10m -> (git status) -> git:status!result -> GARDENER ]

QA = *[ git:committed?msg ->
          (review commit, run tests)
        -> IF clean THEN qa:clean!ok
           ELSE qa:findings!bugs
        -> QA ]

TEST_HUNTER = *[ git:committed?msg -> (find coverage gaps, write tests) -> TEST_HUNTER ]

DOCUMENTARIAN = *[ git:committed?msg -> (update docs to match code) -> DOCUMENTARIAN ]

SIMPLIFIER = *[ git:committed?msg -> (simplify, run tests) -> SIMPLIFIER ]

CARTOGRAPHER = *[ git:committed?msg -> (update roadmap status) -> CARTOGRAPHER ]

SPARK = *[ tick.30m ->
             (read roadmap, read .spider/connections/, propose idea)
           -> spark:idea!proposal
           -> SPARK ]

SPIDER = *[ spark:idea?proposal | tick.2h ->
              (read features, read .spark/ideas/, find connections)
            -> spider:connections!syllogisms
            -> SPIDER ]

NOTIFY_FINDINGS = *[ qa:findings?bugs -> (curl POST /notes) -> NOTIFY_FINDINGS ]
```

### Topology Properties

**P1: Acyclicity of trigger graph.**
The trigger graph (channel-based activation) must be a DAG.
```
Trigger edges:
  git:committed -> {QA, TEST_HUNTER, DOCUMENTARIAN, SIMPLIFIER, CARTOGRAPHER}
  spark:idea -> SPIDER
  qa:findings -> NOTIFY_FINDINGS

This graph has no cycles. VERIFIED by construction.
```

Note: Spark reads Spider's files and Spider reads Spark's files, but this is
*file-based shared state* (blackboard pattern), not *channel-based triggers*.
The asymmetry (Spider triggers on spark:idea, Spark does NOT trigger on
spider:connections) breaks the cycle structurally.

**P2: No orphan channels.**
Every declared channel has at least one producer.
```
  git:committed  -- produced by: external (git hook or human commit)
  git:status     -- produced by: Gardener
  qa:clean       -- produced by: QA
  qa:findings    -- produced by: QA
  spark:idea     -- produced by: Spark
  spider:connections -- produced by: Spider
```
All channels have producers. VERIFIED.

**P3: Singleton enforcement.**
Agents marked `singleton: true` must not have concurrent instances.
```
  singleton agents: Spark, Spider
  Non-singleton: all others (can run in parallel if triggered simultaneously)
```
Enforcement: fleet-engine.ts `running.has(agent.name)` check in `startAgent()`.

## 2. Communication Patterns

### 2.1 Broadcast (Fan-Out)

`git:committed` fans out to 5 consumers simultaneously. This is the CSP
parallel composition:

```
COMMIT_WAVE = QA ||| TEST_HUNTER ||| DOCUMENTARIAN ||| SIMPLIFIER ||| CARTOGRAPHER
```

The `|||` operator is interleaving (independent parallel). These agents share
no channels between each other -- they read the same trigger but produce
independent outputs. No synchronization is needed between them.

**Van der Aalst pattern:** AND-split (all branches activate) with implicit
termination (each branch completes independently).

### 2.2 Asymmetric Dialogue (Spark ↔ Spider)

```
SPARK_SPIDER_DIALOGUE =
  SPARK                              SPIDER
    |                                  |
    |--- spark:idea!proposal --------->|  (channel trigger)
    |                                  |--- spider:connections!syllogisms
    |                                  |
    |<-- [reads .spider/connections/]--|  (file system, NOT channel)
    |                                  |
    |--- spark:idea!proposal --------->|  (next scheduled run)
    ...
```

This is NOT a symmetric request/response. It is:
- **Forward channel:** Spark -> spark:idea -> Spider (CSP channel, synchronous trigger)
- **Backward file read:** Spider -> .spider/connections/ -> Spark (asynchronous, read-at-will)

The asymmetry is intentional. CSP requires that bidirectional channel
communication between two processes risks deadlock if both processes attempt to
send simultaneously on their respective channels. The file-based backward path
avoids this by making the read non-blocking and decoupled from timing.

**Hoare's discipline:** "If two processes need to communicate bidirectionally,
use separate channels for each direction, and ensure at least one direction is
non-blocking or buffered." Here, the file system serves as an unbounded buffer
for the backward direction.

### 2.3 Escalation Chain (QA -> Notify)

```
QA_ESCALATION = QA ; (qa:findings!bugs -> NOTIFY_FINDINGS)
```

This is a CSP sequential composition with conditional activation.
QA produces findings only on failure. The watcher consumes findings and
escalates (posts a note to the daemon). This is a saga-style compensation
pattern: the QA agent's failure triggers a notification action.

### 2.4 Blackboard Pattern (File-Based Shared State)

```
Shared state:
  .spark/ideas/          -- written by Spark, read by Spider
  .spider/connections/   -- written by Spider, read by Spark
  .cartographer/status.md -- written by Cartographer, read by humans
  docs/V4-UNIFIED-ROADMAP.md -- written by Cartographer, read by Spark/Spider

Access pattern:
  Single-writer, multiple-reader (SWMR) for each file set.
  No two agents write to the same directory.
```

This is safe without locking because:
1. Each directory has exactly one writer (no write conflicts)
2. Readers tolerate stale data (they read whatever is there at invocation time)
3. Files are append-only (new timestamped files, never editing existing ones)

**Ostrom mapping:** The file system directories are common-pool resources with
clear boundaries (Principle 1) and proportional access (Principle 2: only the
designated writer can write).

## 3. Gather Policies

When multiple agents are triggered by the same event (e.g., git:committed
triggers 5 agents), the fleet needs a **gather policy** to determine:
- Does anyone wait for the others?
- What happens if one fails?
- How are results combined?

### Current Policy: Fire-and-Forget (No Gather)

Each agent runs independently. No agent waits for another. No results are
combined. This is the simplest gather policy and is appropriate for the current
fleet because:
- Agent outputs go to different places (tests, docs, roadmap)
- No downstream consumer needs ALL agents to complete
- Individual agent failure does not affect others

### Future Policy: Gather-Then-Proceed

For a future "release readiness" check, we would need:
```
RELEASE_CHECK =
  (QA ||| TEST_HUNTER ||| DOCUMENTARIAN)
  ;; GATHER(qa:clean, tests:pass, docs:current)
  -> IF all_pass THEN release:ready!ok
     ELSE release:blocked!reasons
```

This requires:
1. A **barrier** that waits for all three agents
2. A **timeout** (what if one agent hangs?)
3. A **partial result policy** (proceed with 2/3? fail on any failure?)

Implementation path: Add a `gather` field to fleet YAML:
```yaml
gates:
  release-ready:
    requires: [qa:clean, tests:pass, docs:current]
    policy: all          # all | majority | any
    timeout: 300s        # max wait
    on_success: publish release:ready
    on_timeout: publish release:blocked
```

## 4. Confidence Scoring

Each fleet agent should report confidence in its output. This enables the
gather policy to make weighted decisions.

```
Message format (proposed):
{
  "agent": "qa",
  "channel": "qa:clean",
  "confidence": 0.95,        // How sure is the agent?
  "coverage": "full",        // Did it check everything it was asked to?
  "duration_ms": 45000,      // How long did it take?
  "files_examined": 12,      // Scope of work
  "issues_found": 0,
  "payload": "CLEAN — all changed files reviewed, no bugs found"
}
```

Confidence is NOT a quality score. It is the agent's self-assessment of how
thoroughly it completed its task. A QA agent that reviewed 12/12 changed files
reports confidence 1.0. A QA agent that hit a timeout and reviewed 8/12 reports
confidence 0.67. The confidence score does not say whether the code is good --
it says whether the review was complete.

## 5. Cycle Detection (Invariant)

The Arbiter should enforce:

```
FleetAcyclicity:
  For all agents A, B in the fleet:
    IF A.trigger includes channel C
    AND B.on_success publishes to channel C
    AND B.trigger includes channel D
    AND A.on_success publishes to channel D
    THEN VIOLATION (bidirectional trigger cycle)
```

Generalized to transitive cycles:
```
FleetDAG:
  Let G = (V, E) where V = agents, E = {(a,b) | a publishes to a channel that triggers b}
  INVARIANT: G is acyclic (no directed cycles)
```

This can be checked statically when fleet YAML is loaded, before any agent
starts. The fleet-engine.ts `loadFleetConfig()` should validate this.

## 6. TLA+ Specification

```tla
---- MODULE FleetProtocol ----
EXTENDS Integers, FiniteSets, Sequences

CONSTANTS
    Agents,         \* {"gardener", "qa", "test-hunter", "doc", "simplifier", "cartographer", "spark", "spider"}
    Channels,       \* {"git:committed", "git:status", "qa:clean", "qa:findings", "spark:idea", "spider:connections"}
    MaxMessages     \* 10

VARIABLES
    channelQueue,   \* [Channels -> Seq(Message)]
    agentState,     \* [Agents -> {"idle", "running", "done"}]
    agentOutput,    \* [Agents -> {NULL, "success", "failure"}]
    runCount        \* [Agents -> 0..MaxMessages]

vars == <<channelQueue, agentState, agentOutput, runCount>>

Message == [agent: Agents, payload: STRING, confidence: 0..100]

TypeOK ==
    /\ channelQueue \in [Channels -> Seq(Message)]
    /\ agentState \in [Agents -> {"idle", "running", "done"}]
    /\ runCount \in [Agents -> 0..MaxMessages]

Init ==
    /\ channelQueue = [c \in Channels |-> << >>]
    /\ agentState = [a \in Agents |-> "idle"]
    /\ agentOutput = [a \in Agents |-> "NULL"]
    /\ runCount = [a \in Agents |-> 0]

\* An agent can start if it is idle and its trigger channel has a message
\* (or it is a scheduled agent and we model the tick)
TriggerAgent(a, ch) ==
    /\ agentState[a] = "idle"
    /\ Len(channelQueue[ch]) > 0
    /\ agentState' = [agentState EXCEPT ![a] = "running"]
    /\ channelQueue' = [channelQueue EXCEPT ![ch] = Tail(@)]
    /\ UNCHANGED <<agentOutput, runCount>>

ScheduleAgent(a) ==
    /\ agentState[a] = "idle"
    /\ runCount[a] < MaxMessages
    /\ agentState' = [agentState EXCEPT ![a] = "running"]
    /\ UNCHANGED <<channelQueue, agentOutput, runCount>>

\* Agent completes and publishes to its output channel
CompleteAgent(a, outCh, result) ==
    /\ agentState[a] = "running"
    /\ agentState' = [agentState EXCEPT ![a] = "idle"]
    /\ agentOutput' = [agentOutput EXCEPT ![a] = result]
    /\ runCount' = [runCount EXCEPT ![a] = @ + 1]
    /\ IF outCh /= "none"
       THEN channelQueue' = [channelQueue EXCEPT ![outCh] = Append(@, [agent |-> a, payload |-> result, confidence |-> 80])]
       ELSE UNCHANGED channelQueue

\* ---- INVARIANTS ----

\* No two singleton agents run simultaneously
SingletonSafety ==
    \A a1, a2 \in {"spark", "spider"} :
        a1 /= a2 =>
            ~(agentState[a1] = "running" /\ agentState[a2] = "running"
              /\ a1 = a2)  \* Same agent, two instances

\* Messages are never lost (channels are bounded but not overflowed)
ChannelBounded ==
    \A ch \in Channels : Len(channelQueue[ch]) <= MaxMessages

\* Every completed agent eventually returns to idle
AgentTerminates ==
    \A a \in Agents :
        agentState[a] = "running" ~> agentState[a] = "idle"

Next ==
    \/ \E a \in Agents, ch \in Channels : TriggerAgent(a, ch)
    \/ \E a \in {"gardener", "spark", "spider"} : ScheduleAgent(a)
    \/ \E a \in Agents, ch \in Channels \cup {"none"}, r \in {"success", "failure"} :
         CompleteAgent(a, ch, r)

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)
====
```

## 7. Runtime Enforcement via Arbiter

The following invariants should be added to `lib/arbiter.ts`:

| Invariant | Strategy | Check |
|-----------|----------|-------|
| FleetDAG | Static (on YAML load) | Topological sort of trigger graph |
| SingletonSafety | Sync (on spawn) | Check running map before starting |
| ChannelBounded | Sampled (10s) | Count pending messages per channel |
| AgentTerminates | Sampled (60s) | Check for agents running > timeout |
| BlackboardSWMR | Static (on YAML load) | Verify each output dir has one writer |

## 8. Fleet Harbor Protocol

All fleet agents share a harbor: `{project}:fleet`. This provides:

1. **Scoped discovery:** `trie.prefix('{project}:fleet:*')` returns all fleet agents
2. **Scoped messaging:** Harbor members can subscribe to harbor-scoped channels
3. **Collective identity:** The harbor is the agent collective's identity in the broader system

The harbor is created by fleet-engine.ts on `startAll()` and agents are enrolled
as they start. This is Ostrom's Principle 1 (clear boundaries) applied to the
fleet.

## 9. Future Work

### 9.1 Typed Channels (Discriminated Union Messages)

Currently channel messages are untyped JSON. Typed channels would allow
compile-time verification that producers and consumers agree on message shape:

```typescript
type FleetChannelMap = {
  'git:committed': { sha: string; files: string[]; author: string };
  'qa:clean': { agent: 'qa'; confidence: number; filesReviewed: number };
  'qa:findings': { agent: 'qa'; bugs: Array<{ file: string; line: number; description: string }> };
  'spark:idea': { agent: 'spark'; title: string; description: string; file: string };
  'spider:connections': { agent: 'spider'; syllogisms: Array<{ premiseA: string; premiseB: string; therefore: string; confidence: string }> };
};
```

### 9.2 Conversation Protocols (FIPA-Style)

For more complex fleet interactions (debate, critique-refine), define
conversation protocols with explicit state machines:

```
CRITIQUE_REFINE(producer, critic, maxRounds) =
  producer -> draft!v1
  -> critic -> critique!issues
  -> IF issues.severity > threshold
     THEN producer -> draft!v2 -> critic -> critique!issues2 -> ...
     ELSE critic -> approve!ok
  UNTIL approved OR maxRounds reached
```

### 9.3 Semantic Channel Routing via Trie

Currently channels are named strings. With the semantic trie, agents could
subscribe to identity patterns:

```
// Instead of: subscribe to "qa:findings"
// Do: subscribe to "port-daddy:fleet:qa:*"
// This catches qa:clean AND qa:findings
```

This is the Spider's first syllogism made real: "We have a semantic trie AND
we have pub/sub channels, THEREFORE we can have topic-routed subscriptions."
