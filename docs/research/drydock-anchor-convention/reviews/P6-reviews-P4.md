# P6 reviews P4 — conserved capacity versus hypertree execution

**Round 2 · reciprocal · sealed**

## Steel-man

1. **Strongest thesis — P4:** replace “summon a swarm” with a sealed `ExecutionPlan`; an external controller advances an eligible frontier, workers cannot enlarge topology, hyperedges declare joins, and growth requires a new plan digest.
2. **Best evidence/falsifier — P4:** crash/restart, duplicate delivery, stale lease, missing child, rework exhaustion, and cancellation-race exploration must preserve exactly one admission and one terminal accounting record.
3. **Protected invariant/operator outcome — P4:** every fan-out has a gather and every child a terminal receipt, yielding a finite answer about completion, omissions, risk, resource use, and replay eligibility.

## Strongest unresolved tension

P4 treats capacity as an initial constraint but not as a conserved lifecycle. It
does not state that every lease, renewal, elastic slot, retry, gather, and plan
revision needs a fresh reservation across cash, subscription windows, context,
compute, concurrency, effects, checkpoint tail, and unresolved-provider holds.
A deterministic scheduler can still oversubscribe a shared alias, reuse an
unsettled slot, consume shutdown capacity, or treat provider lag as headroom.

The controller may request and redeem reservation-backed leases; only the
capacity broker may observe, reserve, hold, settle, and release capacity.

## Falsifier for this critique

Produce one closed crash-schedule trace in which every node, elastic slot, lease
renewal, rework attempt, and provider-consuming gather references a live broker
reservation including `p95 burn + checkpoint/stop tail`. Lose a provider reply
during cancellation and prove no capacity is reused until independent settlement
or explicit `HELD_AMBIGUOUS` state.

## Narrow amendment requested from P4

Every lease, renewal, elastic slot, rework attempt, and provider-consuming
gather references a live atomic capacity reservation for its native resource
vector plus checkpoint/stop tail. Plan revisions may narrow but never silently
enlarge or reuse it. Crash, cancellation, expiry, and reduction settle, release,
or explicitly hold each reservation before capacity re-enters the frontier.

## Revision required from P6

P6 concedes that “reserve the run” is too coarse. Reservations bind to
`{executionPlanDigest, planRevision, nodeId, attempt, bodyGeneration}`. A plan-
wide grant is only a ceiling; node-attempt reservations are the committed debits.
Typed gathers and addressed questions also conserve capacity when their reducers
are deterministic and their escalation choices bounded. Attention should be
accounted at pending decision nodes and interruption rate, not as one run-wide
number.

## Retained dissent

A gather may seal a partial semantic result while the capacity ledger remains
nonterminal; `deadline-with-partials` cannot release an absent child's resources.
A model-consuming gather needs its own reservation. `K` is not a scalar: every
native dimension must fit before policy ranks eligible partitions.

## Confidence

High confidence that P4 and P6 are compatible and continuous reservation/
settlement is the missing join. Medium confidence on plan-wide versus node-
attempt reservation mechanics; deterministic fake-broker traces should decide.

**SEALED — P6→P4 — 2026-09-16.**
