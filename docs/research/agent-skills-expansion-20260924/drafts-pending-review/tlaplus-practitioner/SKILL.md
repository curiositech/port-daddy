---
name: tlaplus-practitioner
license: Apache-2.0
description: >
  You MUST use this skill when writing, running, or verifying TLA+ specifications
  for distributed systems, coordination protocols, or state machine designs. This
  skill is opinionated and prescriptive — it will push you toward bounded model
  checking with TLC, concrete worked examples, and measurable quality gates.
  NOT FOR: general formal methods theory, Coq/Lean/Isabelle proof assistants,
  SPIN/Promela model checking, or theorem proving without explicit state machines.
---

# TLA+ Practitioner

## When to Use This Skill

IF the task involves any of these THEN apply this skill:
- Advisory locks with TTL and owner semantics
- Agent lifecycle: register, heartbeat, crash, reap, salvage
- Escrow or bonded state machines (hold, release, forfeit)
- Distributed coordination with crash recovery
- Safety properties ("bad thing never happens")
- Liveness properties ("good thing eventually happens")

IF the task is purely about type systems, proof assistants, or model checking
without state machines THEN stop -- this skill does not apply.

## Choose a Model Scope

See [model scope and fairness](references/model-scope-and-fairness.md) before translating implementation claims into finite models.

Use [the model-selection workflow](diagrams/research-t01-decide-whether-a-finite-state-model-helps-ascii-conversion.md) to decide whether a state-machine model adds value and which property it can examine. A finite model can expose counterexamples within declared bounds; it does not establish production behavior by itself. See `evals/evals.json` for worked evaluation cases.

## Section 1: Advisory Locks with TTL

IF you have a lock with an owner, a TTL, and multiple agents competing THEN verify:
- **Safety**: No two agents hold the same lock simultaneously
- **Liveness**: A crashed holder's lock eventually expires and is acquirable

Key actions: `Acquire(a,l)`, `Release(a,l)`, `Crash(a)`, `Tick`.
Key invariant: `MutualExclusion`. Key liveness: `LockEventuallyFrees` with `WF_vars(Tick)`.
See BondedCommons (Section 4) for a full worked example combining locks + crash recovery.

## Section 2: Crash-Reap-Salvage Lifecycle

IF your system has agents that register, heartbeat, crash silently, get reaped,
and have work salvaged by another agent THEN verify:
- **Safety**: A reaped agent's work is claimed by at most one salvager
- **Safety**: No agent is reaped while still alive (heartbeating)
- **Liveness**: Dead agents eventually enter the salvage queue

Port Daddy mapping:

| TLA+ Concept       | Port Daddy Implementation              |
|---------------------|----------------------------------------|
| `heartbeat[a]`      | `agents.last_heartbeat` column         |
| `status = "stale"`  | A source-specific status boundary; inspect the pinned implementation. |
| `status = "dead"`   | A source-specific reaping boundary; inspect the pinned implementation. |
| `salvageClaims`     | `resurrection_queue.status = "claimed"` |
| `SingleClaimer`     | `UNIQUE(agent_id)` on resurrection_queue|

## Section 3: Escrow State Machines

IF your system holds a resource in escrow with transitions like:
- `open -> bonded -> released` (happy path)
- `open -> bonded -> forfeited` (violation path)
- `open -> expired` (timeout path)

THEN verify:
- **Safety**: A forfeited bond cannot be released (no double-spend)
- **Safety**: Total value is conserved across transitions
- **Liveness**: Every bond eventually reaches a terminal state

## Section 4: Worked Example -- BondedCommons (Port Daddy)

Port Daddy agents claim ports (advisory locks). Each claim is bonded: the agent
promises to heartbeat. If the agent crashes, the reaper detects missed heartbeats,
marks the agent dead, releases its ports, and enters it into a salvage queue.
Another agent can claim the salvaged work.

This example deliberately models a crash-detection event as a true crash: a `stale` agent cannot heartbeat again. It excludes live-but-paused agents, delayed/reordered heartbeats, and external lease fencing, so it cannot establish “no live agent is ever reaped” for a production failure detector. The represented safety property is that a dead/salvaged owner holds no port and each port maps to at most one owner.

```tla
---- MODULE BondedCommons ----
EXTENDS Integers, FiniteSets, TLC

CONSTANTS
    Agents,         \* e.g., {"a1", "a2", "a3"}
    Ports,          \* e.g., {9001, 9002}
    MaxTTL,         \* e.g., 5
    DeadThreshold   \* e.g., 3

VARIABLES
    portOwner,      \* [Ports -> Agents \cup {""}]
    heartbeat,      \* [Agents -> 0..MaxTTL]
    agentStatus,    \* [Agents -> {"alive", "stale", "dead", "salvaged"}]
    salvageQueue,   \* SUBSET Agents
    clock

vars == <<portOwner, heartbeat, agentStatus, salvageQueue, clock>>

ASSUME DeadThreshold \in 1..MaxTTL

TypeOK ==
    /\ portOwner \in [Ports -> Agents \cup {""}]
    /\ heartbeat \in [Agents -> 0..MaxTTL]
    /\ agentStatus \in [Agents -> {"alive", "stale", "dead", "salvaged"}]
    /\ salvageQueue \subseteq Agents
    /\ clock \in 0..MaxTTL

Init ==
    /\ portOwner = [p \in Ports |-> ""]
    /\ heartbeat = [a \in Agents |-> 0]
    /\ agentStatus = [a \in Agents |-> "alive"]
    /\ salvageQueue = {}
    /\ clock = 0

ClaimPort(a, p) ==
    /\ agentStatus[a] = "alive"
    /\ portOwner[p] = ""
    /\ portOwner' = [portOwner EXCEPT ![p] = a]
    /\ heartbeat' = [heartbeat EXCEPT ![a] = clock]
    /\ UNCHANGED <<agentStatus, salvageQueue, clock>>

Heartbeat(a) ==
    /\ agentStatus[a] = "alive"
    /\ heartbeat' = [heartbeat EXCEPT ![a] = clock]
    /\ UNCHANGED <<portOwner, agentStatus, salvageQueue, clock>>

ReleasePort(a, p) ==
    /\ agentStatus[a] = "alive"
    /\ portOwner[p] = a
    /\ portOwner' = [portOwner EXCEPT ![p] = ""]
    /\ UNCHANGED <<heartbeat, agentStatus, salvageQueue, clock>>

Crash(a) ==
    /\ agentStatus[a] = "alive"
    /\ agentStatus' = [agentStatus EXCEPT ![a] = "stale"]
    /\ UNCHANGED <<portOwner, heartbeat, salvageQueue, clock>>

Reap(a) ==
    /\ agentStatus[a] = "stale"
    /\ clock - heartbeat[a] >= DeadThreshold
    /\ agentStatus' = [agentStatus EXCEPT ![a] = "dead"]
    /\ salvageQueue' = salvageQueue \cup {a}
    /\ portOwner' = [p \in Ports |
        IF portOwner[p] = a THEN "" ELSE portOwner[p]]
    /\ UNCHANGED <<heartbeat, clock>>

Salvage(claimer, dead) ==
    /\ agentStatus[claimer] = "alive"
    /\ dead \in salvageQueue
    /\ agentStatus[dead] = "dead"
    /\ agentStatus' = [agentStatus EXCEPT ![dead] = "salvaged"]
    /\ salvageQueue' = salvageQueue \ {dead}
    /\ UNCHANGED <<portOwner, heartbeat, clock>>

Tick ==
    /\ clock' = IF clock < MaxTTL THEN clock + 1 ELSE clock
    /\ UNCHANGED <<portOwner, heartbeat, agentStatus, salvageQueue>>

Next ==
    \/ \E a \in Agents, p \in Ports : ClaimPort(a, p)
    \/ \E a \in Agents : Heartbeat(a)
    \/ \E a \in Agents, p \in Ports : ReleasePort(a, p)
    \/ \E a \in Agents : Crash(a)
    \/ \E a \in Agents : Reap(a)
    \/ \E a1, a2 \in Agents : a1 /= a2 /\ Salvage(a1, a2)
    \/ Tick

\* ---- INVARIANTS (Safety) ----
UniqueOwnerMapping ==
    \A p \in Ports :
        portOwner[p] /= "" => agentStatus[portOwner[p]] \in {"alive", "stale"}

DeadOwnsNothing ==
    \A a \in Agents :
        agentStatus[a] \in {"dead", "salvaged"} =>
            \A p \in Ports : portOwner[p] /= a

\* ---- TEMPORAL PROPERTIES (Liveness) ----
StaleEventuallyReaped ==
    \A a \in Agents :
        (agentStatus[a] = "stale") ~> (agentStatus[a] = "dead")

Spec == Init /\ [][Next]_vars
    /\ WF_vars(Tick)
    /\ WF_vars(\E a \in Agents : Reap(a))
====
```

### Running BondedCommons

```bash
# BondedCommons.cfg: use the specification carrying the declared fairness.
cat > BondedCommons.cfg << 'EOF'
CONSTANTS
    Agents = {"a1", "a2", "a3"}
    Ports = {9001, 9002}
    MaxTTL = 5
    DeadThreshold = 2
SPECIFICATION Spec
INVARIANTS
    TypeOK
    UniqueOwnerMapping
    DeadOwnsNothing
PROPERTIES
    StaleEventuallyReaped
EOF

java -cp tla2tools.jar tlc2.TLC BondedCommons -workers auto
```

### Quality Gate

Record the exact TLA+ Tools version, model constants, state/transition counts,
symmetry, deadlock setting, invariants, temporal properties, fairness assumptions,
and counterexamples. Choose small finite bounds that preserve the race/property
under review, then vary them as sensitivity checks. A passing bounded TLC run is
evidence about that model only; no state-count threshold proves adequacy. A mutation
that violates an invariant should produce a counterexample under the same model,
but that checks only the model/test setup, not implementation completeness.

## Running TLC and Choosing Bounds

Use [the bounded TLC workflow](diagrams/research-t02-bounded-tlc-workflow-and-claim-limits-rewrites-existing-mermaid.md). Put safety invariants and liveness properties in the configuration only after confirming the checked `SPECIFICATION` includes the relevant fairness assumptions. Safety is checked across explored transitions; liveness claims depend on the specification and environment assumptions. Bounds and state counts are descriptive model parameters, not coverage targets or production equivalents. If exploration is too large, reduce the smallest dimension that preserves the race under study, document the omitted behaviors, and run a sensitivity model.


## Interpreting Counterexamples

Use [the counterexample/fairness diagnosis](diagrams/research-t03-fairness-changes-the-temporal-claim-ascii-conversion.md). Inspect the trace and the exact enabledness/fairness premise before changing guards or adding fairness. Fairness excludes behaviors; add it only when the environment or implementation guarantees the action is eventually scheduled. A liveness failure may be a real counterexample or an unjustified/missing environmental premise; report which.

## Failure Modes

### FM1: State Space Explosion (OutOfMemoryError)

**Symptom**: Exploration grows beyond the available time or memory budget. **Diagnosis**: Bounds, symmetry, or the modeled state may be too large; inspect TLC’s reported state space rather than assuming a universal performance signature.
**Fix**: Use `0..MaxVal` not `Nat`. Add symmetry: `Symmetry == Permutations(Agents)`.

### FM2: Liveness Fails Despite Correct Logic

**Symptom**: Lasso counterexample where everything "looks right."
**Diagnosis**: Inspect the lasso, enabledness, and temporal formula. The trace may expose a real liveness failure, or it may be excluded only if the modeled environment guarantees a particular enabled action eventually runs.
**Fix**: Add weak or strong fairness only for actions whose scheduling guarantee is justified by the implementation/environment contract. Name which behaviors the assumption excludes and rerun the model; do not add fairness only to silence the trace.

### FM3: Invariant Violation on a "Correct" State

**Symptom**: TLC flags violation but state looks fine visually.
**Diagnosis**: TypeOK too narrow, or you split an atomic action into two steps exposing
an intermediate state. TLA+ actions are atomic -- if two variables must update together,
they belong in one action.

### FM4: Unexpected Deadlock

**Symptom**: No `Next` action enabled. **Diagnosis**: Check whether the state is an intended terminal state, a missing transition, or an abstraction artifact (for example, a saturating clock). **Fix**: If terminal behavior is intended, specify and check the terminal-state condition explicitly. Otherwise repair the transition relation. TLC's `-deadlock` option disables deadlock checking; use it only when deadlocks are intentionally allowed and analyzed separately.

## Anti-Patterns (Novice vs Expert)

**Modeling implementation details** -- Novice writes SQL schemas in TLA+. Expert
models state transitions: `portOwner \in [Ports -> Agents]`, not table DDL.

**One giant Next action** -- Novice puts everything in one disjunction. Expert
decomposes into named actions (ClaimPort, Crash, Reap) so counterexamples are readable.

**Skipping TypeOK** -- write a type invariant to expose out-of-domain transitions. It checks only the types represented in the model and is not a substitute for domain invariants.

**Unbounded model checking** -- Novice uses `Nat` or `Seq(S)` without bounds. TLC
chokes. Expert bounds everything: `0..MaxN`, `Len(seq) <= MaxLen`.

**Specs after the code ships** -- Novice verifies post-hoc. Expert writes specs during
design when uncertainty is highest. The best time to write BondedCommons is before
implementing the reaper.

## Safety vs Liveness Quick Reference

| Type     | TLA+ Keyword | Meaning                          | Needs Fairness? |
|----------|-------------|----------------------------------|------------|
| Safety   | `INVARIANT` | Bad thing never happens          | No              |
| Liveness | `PROPERTY`  | Good thing eventually happens    | Yes (WF/SF)     |

IF safety only THEN use INVARIANTS, skip fairness. Simpler and faster.
IF liveness THEN use `~>`, `<>`, or `[]<>` operators and declare fairness in Spec.

## File Organization

Keep a spec, its model configuration, and an explanation/trace note together; the configuration must invoke the same `Spec` and fairness contract whose results are being reported. See [spec/config/report artifact map](diagrams/research-t04-spec-config-report-artifact-map.md).

## Bundled Assets

- **`evals/evals.json`** — Evaluation cases mapping prompts to decision tree paths and expected outputs. Reference when validating your scope and expected outputs for each pattern.

## Quality Gates Checklist

- [ ] TypeOK passes as invariant
- [ ] At least one domain safety invariant passes
- [ ] Bounds, state counts, fairness, invariants/properties, and counterexamples are recorded; no state-count threshold is treated as proof
- [ ] Finite bounds preserve the concurrency/race under study and are documented as model-specific
- [ ] Intentionally broke an invariant, confirmed TLC catches it
- [ ] Liveness properties verified with declared fairness (if applicable)
- [ ] .cfg committed alongside .tla
- [ ] Constants documented with bound rationale


## Model assumptions and fairness

The BondedCommons example treats `Crash(a)` as an actual crash and disallows subsequent heartbeats for that state. It does not model a live process with a delayed heartbeat, a false suspicion, a resurrected old generation, or target-enforced fencing. The `clock` saturates at `MaxTTL`, so time can still stutter and `Reap` can remain enabled. `StaleEventuallyReaped` requires both weak fairness for `Tick` and weak fairness for some enabled `Reap`; the `.cfg` must select `SPECIFICATION Spec` to check that temporal formula under those assumptions. This is not production or deployment proof.

TLC was **NOT_RUN** in this draft. The model text/config has not been compiled or model-checked, so syntax and counterexample claims remain unverified.
