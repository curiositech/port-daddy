# Deterministic Simulation And Formal Models

Use this when designing Trial Basin scenarios for concurrency, retries, crashes,
cancellation, distributed workers, spend ledgers, teardown, or recovery.

## Determinism is an input contract

Make the product nucleus a pure transition:

```text
step(state, action, virtual_time, entropy_word)
  -> (next_state, declared_effects)
```

Adapters perform only admitted declared effects and return typed observations for
the next transition. Begin with one explicit event queue. Wall time, random IDs,
sleep, filesystem outcomes, transport delivery, provider chunks, faults, and
operator decisions are inputs rather than hidden calls. This keeps test schedulers
and failpoint APIs out of the production authority path.

A deterministic simulation records and controls every source that can change an
execution:

- random seed and generated values;
- virtual clock, timer firing, timeout, and wall-clock jumps;
- thread/task scheduling and message-delivery order;
- fake/replay provider responses, chunking, and latency;
- filesystem and storage outcomes;
- process crash, pause, restart, and kill points;
- network delivery, duplication, drop, partition, reordering, and asymmetry;
- operator decisions and capability promotion; and
- controller faults, including receipt-store and teardown interruption.

The same sealed inputs, seed, and schedule must reconstruct the observation. A test
that says “we injected random failures” but cannot replay one is a chaos demo, not a
debuggable proof.

Deterministic simulation testing commonly combines controlled nondeterminism,
multiple seeds, property-based generation, state-space exploration, and fault
injection. Its value is not that one timeline is realistic; it is that many legal
timelines can be explored and a failing one can be replayed exactly.

Primary source: [Antithesis: Deterministic simulation testing](https://antithesis.com/docs/resources/deterministic_simulation_testing/).

## Scenario manifest

Every scenario should seal:

```yaml
scenarioId: reservation-cancel-race
scenarioDigest: sha256:...
subjectDigest: sha256:...
controllerDigest: sha256:...
seed: 1844674407370955161
virtualEpoch: 2026-01-01T00:00:00Z
schedulePolicy: bounded-dfs-v1
preemptionBound: 4
faultBudget: 3
fixturesDigest: sha256:...
invariants:
  - ledger-conservation
  - at-most-one-provider-dispatch
  - terminal-revocation
liveness:
  - every-admitted-request-eventually-settles-holds-or-cancels
```

The replay receipt adds the chosen schedule, generated values, event trace,
counterexample, and minimization history.

`virtualEpoch` is the sealed mapping from virtual time zero to a display timestamp.
The virtual clock is the evolving integer offset from that epoch, represented in
nanoseconds in the canonical schema. Advancing virtual time changes the offset,
not `virtualEpoch`; wall-clock reads never rewrite either value.

## Safety and liveness

Write both:

- **Safety:** a forbidden state is never reached. Examples: no negative balance,
  no dispatch without reservation, no artifact outside quarantine, no live lease
  after terminal kill.
- **Liveness:** a required state is eventually reached under named assumptions.
  Examples: every reservation eventually settles, releases, or enters adjudication;
  every orphan is eventually found and destroyed; cancellation eventually revokes
  all effect channels.

Safety alone can “pass” because the system does nothing forever. Liveness alone can
hide dangerous intermediate states. State the fairness assumptions explicitly; do
not smuggle “the provider eventually responds” into a test without naming it.

TLC is an explicit-state model checker that can check safety and liveness properties
of finite models. Use TLA+ for lifecycle and ledger design before code, then test
the concrete implementation separately.

Primary sources:

- [TLA+ tools and TLC](https://lamport.azurewebsites.net/tla/tools.html)
- [TLA+ liveness tutorial](https://lamport.azurewebsites.net/tla/tutorial/session9.html)

## Exploration strategy

Use layers rather than one enormous state space:

1. **Exhaustive tiny model:** two actors, two requests, tiny balances, every crash
   boundary, duplicate delivery, and cancellation ordering.
2. **Bounded implementation interleavings:** concurrency primitives under a small
   preemption bound.
3. **Seeded system simulation:** many actors and realistic fixtures across thousands
   of deterministic schedules.
4. **Incident replay:** exact production-like trace, then perturb one dimension at
   a time around the failure.
5. **Long soak:** deterministic seeds selected to maximize new states, not merely
   wall-clock duration.

Use table tests and Proptest for the pure sequential state machine, Tokio paused
time only where production code uses Tokio time, Loom for tiny synchronization
primitives, Shuttle for larger sampled schedules, Turmoil for later Tokio network
models, and TLA+ for a small abstract lease/budget/retry/teardown model. None of
these substitutes for a real VM or SQLite crash witness.

Loom can permute Rust concurrency-sensitive operations and reduce the explored
state space, but only operations using Loom replacements are visible, and complex
models still face combinatorial explosion. Use it for small concrete concurrency
components, not whole-system containment.

Primary source: [Loom crate documentation](https://docs.rs/loom/latest/loom/).

## Fault library

At minimum include:

- crash before and after each durable transition;
- duplicate, delayed, reordered, and lost messages;
- asymmetric partition and half-open stream;
- provider stream continuing while cancellation races;
- usage omitted, delayed, malformed, or greater than reservation;
- clock skip forward/backward and lease expiry at a boundary;
- disk full, fsync failure, partial artifact, and receipt append failure;
- process pause, CPU starvation, memory pressure, PID exhaustion, and log flood;
- controller restart with live guest and guest restart with revoked controller state;
- false guest PASS, wrong source digest, stale policy, and stale price catalog; and
- two workers attempting the same capability, balance, output path, or settlement.

Include a stale-lease fencing case in the minimum suite: worker A holds generation
`g`; its lease expires; worker B receives `g+1`; then A attempts completion,
publication, or settlement. Every effect and charge carries holder identity plus
the current generation. A job ID alone is not authority.

Fault injection is not the oracle. Invariants and externally witnessed terminal
states decide the outcome.

## Counterexample discipline

For every failure preserve:

- exact seed and full schedule;
- first invariant violation and witness;
- minimal causal prefix;
- minimized actors, messages, and fault set;
- controller/subject/fixture digests;
- whether replay reproduced exactly; and
- the smallest regression scenario promoted to the permanent gate suite.

Do not discard a failure because a later seed passed. Do not label a non-reproducible
failure PASS. Use `INCOMPLETE` or `UNCERTAIN` until the witness is understood.

## What formal or simulated proof does not establish

- A TLA+ model does not prove the implementation refines it unless that relation is
  separately established.
- Loom does not observe concurrency operations outside its instrumented types.
- A deterministic guest run does not prove the host hypervisor boundary.
- A fake provider does not prove a real provider's billing or enforcement behavior.
- A million seeds do not prove unvisited states impossible.

State the exact bounded claim each technique supports.
