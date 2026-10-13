# P4 — Bounded Hypertree Execution and Coordination

Status: sealed Round 1 position · `SOURCE_PRESENT` + `PROPOSED`

## Thesis

Drydock should not summon a swarm. It should admit one sealed execution plan
and let an external controller advance only the already-eligible frontier of a
typed hypertree. An agent is a temporary, bounded context holder for one work
partition. It neither owns the plan nor gains authority to enlarge it.

The source already specifies an acyclic eligibility model, append-only events,
projection-only clients, zero recursive births, external retry ownership,
separate producer/reviewer/manager roles, and bounded rework. That is static
contract evidence, not a running scheduler or safety witness.

## Strongest design

Use an immutable `ExecutionPlan` with five node kinds:

- `work`: produces a bounded deliverable;
- `evidence`: creates or verifies a named witness;
- `review`: evaluates explicit acceptance criteria;
- `gather`: reduces upstream receipts under a declared fan-in rule; and
- `terminal`: emits the final run disposition and evidence root.

A hyperedge declares `all`, `quorum(n)`, or `deadline-with-partials`. No agent
may create a child. It may emit a `PlanChangeProposal`, which becomes a new
controller-reviewed plan revision with a new digest. “Need another agent” is
evidence, not authority.

Invocation has six stages:

1. Operator intent names effect ceiling, deadline, budget, trust class, and
   desired terminal condition. Intent shaping produces a proposal only.
2. The controller validates sealed inputs, hard caps, acyclicity, partition
   boundaries, trust policy, and initial capacity reservation.
3. A deterministic reducer finds the eligible frontier and atomically grants
   leases only within wave, concurrency, ancestry, worktree/path, and capacity
   constraints.
4. Each worker receives a minimal capsule: input digests, scoped contract,
   permitted skills/tools, tickets, and upstream receipts. It does not inherit
   the parent transcript wholesale.
5. Workers emit typed receipts. Gather nodes reduce receipts under declared
   policy rather than asking a manager to reread all raw output.
6. A terminal reducer seals the event root, missing-child set, risks, resource
   consumption, and replay eligibility. Porthole projects; it cannot mutate.

This is structured concurrency for agents. Every birth belongs to one parent
plan, has a lease and cancellation path, and joins through a declared gather.
The controller is intentionally a serial bottleneck for allocation of authority
and durable state, while work, review, and evidence can run in parallel. It does
not synthesize prose or micromanage ordinary progress.

Partition first by hard boundaries: trust tier, effect authority, repository and
worktree, file/symbol ownership, confidentiality, and causal prerequisites.
Only then optimize cross-cut cost with graph partitioning or semantic routing.
A clustering score can propose a partition; it cannot open a lease.

Choose `K` as the minimum of ready partitions, available capacity, plan cap,
and independently reviewable resource slots. Increase it only through a plan
revision or a predeclared elastic slot with an existing reservation. Context
pressure alone is not a birth trigger.

Conversation is sparse and typed. Heartbeat, progress, cancellation
acknowledgement, and lease renewal are ephemeral. Questions, blocks, handoffs,
evidence, reviews, plan changes, receipts, cancellation, and terminal outcomes
are durable. A question has a recipient, deadline, dependency impact, and answer
schema. A missing answer blocks a node; it does not start an unbounded chat.

Supervision separates:

- controller: admission, leases, reducer, breaker, cancellation;
- effect broker: capability and spend enforcement;
- reviewer: named acceptance criteria and bounded rework; and
- Porthole/Observatory: read-only evidence projection and zoom.

Managers are exceptional: risk threshold, unresolved reviewer conflict, or
terminal approval. A manager selects from explicit `approve`, `escalate`,
`halt`, or predeclared `add-role` choices. It cannot waive a safety gate or
improvise an unbounded team.

Loops are not graph edges. A review may request exactly one named rework target
with a reason code, reserved resources, and round limit. Rework creates a new
attempt on the same work node. A second rejection escalates or terminates. A
topology change requires a plan revision. The controller owns the only retry
layer; workers own none.

Terminal states are explicit: `COMPLETED`, `BLOCKED`, `FAILED`, `CANCELLED`,
`EXPIRED`, `FENCED`, `QUARANTINED`, and `ESCALATED`. Every state emits a receipt.
Research may gather declared partials; safety, containment, promotion, and
effect-bearing work require `all` plus independent acceptance.

Replay reconstructs a new observation-only run from event order, plan digest,
input/capsule digests, body identities, tool/effect receipts, and projection
cursor. Effects are denied by default. Seeking backward in Porthole is
observation, not execution time travel.

## Non-negotiables

1. No birth without a pre-reserved controller-issued lease.
2. Hard authority/context boundaries precede optimization.
3. Every fan-out has a gather; every child has a terminal receipt.
4. Review may request bounded rework; growth requires a new sealed plan.
5. Observation, authorization, execution, and certification stay separate.

## Falsification tests

- Crash/restart, duplicate delivery, stale lease, hostile content, missing child,
  rework exhaustion, and cancellation races preserve one admission and one
  terminal accounting record.
- Compare conservative static `K` with adaptive partitioning on real work
  traces; adaptive policy must reduce cost without leaking context or harming
  acceptance.
- Demonstrate that sharded reducers preserve exactly-once admission and causal
  replay before decentralizing the ledger writer.
- Compare typed addressed questions with peer chat; direct dialogue must show a
  bounded correctness or safety gain to be admitted.
- Counterfactual replay must deny effects and surface every substituted input.

## Impossible combinations

- Recursive autonomous delegation and a hard global cap without central
  admission.
- Arbitrary peer chat and minimal attributable context with deterministic replay.
- A read-only observatory that also issues effects.
- Mutable inputs and exact replay claims.
- Untrusted event content and ambient unrestricted tools.
- All-context broadcast and confidentiality/cost/context-quality boundaries.
- One actor requesting, authorizing, executing, and certifying an effect.

## Skill findings

- `swarm-invocation-designer` needs controller-only admission, gather semantics,
  plan revision, activation tests, and an explicit recursive-birth prohibition.
- `agent-context-partitioner` has valuable causal-closure rules but lacks a
  changelog, closed schema, executable tests, and calibrated K/leakage studies.
- `fleet-event-spawn-trust` needs controller-issued lease integration and a
  provenance schema.
- `hypertree-planning` activates too broadly and has stale or unsupported
  performance claims; tighten it to explicit hyperedge decisions and primary
  evidence.
- `pilot-hypertree-execution` needs typed gathers, trust/effect boundaries, and
  a rule that workers never schedule workers.

## Missing skill

`hypertree-execution-admission-gather`

Activate for controller lease issuance, deterministic frontier reduction,
hyperedge gathers, cancellation, bounded rework, terminal receipts, and event
replay. **NOT for** partition algorithms, message-bus selection, VM containment,
live runtime operation, or a worker's own task execution.

It should contain a closed schema, deterministic reducer, property tests for
duplicate/crash/cancel/rework races, replay fixtures, and negative activation
cases such as “the agent decides to spawn another agent.”

## Confidence and unknowns

Confidence is high in bounded admission and gather semantics, moderate in one
writer at scale, and low in unbenchmarked partition heuristics. Unknowns include
controller throughput, provider cancellation semantics, measured context-transfer
cost, and whether bounded peer questions outperform controller routing.
