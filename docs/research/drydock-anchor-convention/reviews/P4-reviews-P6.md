# P4 reviews P6 — scheduling authority versus capacity authority

**Round 2 · reciprocal · sealed**

## Steel-man

1. **Strongest thesis — P6:** scarce resources remain separate conserved dimensions, and an external `CapacityBroker` reserves `p95 burn + stop tail + uncertainty margin` before dispatch. Anchor may attenuate a reservation but cannot create capacity.
2. **Best evidence/falsifier — P6:** alias oversubscription, crash-window release or double charge, stale observations, retry during ambiguous settlement, and consumption of stop tail each identify a conservation violation.
3. **Protected invariant/operator outcome — P6:** stopping remains affordable. Checkpoint capacity, revocation time, cancellation headroom, and operator attention cannot be consumed by ordinary work.

## Strongest unresolved tension

P4 says the controller validates capacity and grants a worker lease. P6 says the
capacity broker atomically reserves every bucket. Both are valid authorities,
but no linearization point connects them:

```text
eligible frontier
→ capacity reservation
→ execution lease
→ provider dispatch
```

A crash before lease must not leak capacity forever; a crash after lease but
before acknowledgement must not create an unaccounted body; duplicate delivery
must not launch twice from one reservation. Giving the broker scheduling power
would erase P4's boundary. Separate SQLite writers are not a shared transaction.

## Falsifier for this critique

Provide a model and executable fault suite proving, across every crash boundary,
duplicate, stale reply, and reordered message: at most one live lease per node
attempt; no dispatch without one committed reservation; no reservation reused;
ambiguous dispatch retains its hold; and recovery converges without either
component inventing the other's state.

## Narrow amendment requested from P6

`CapacityBroker` never decides node eligibility, grants body leases, launches
workers, or advances the hypertree. It may issue one single-use
`ReservationCommit` bound to plan digest, node, attempt, body generation, route,
resource-vector ceiling, expiry, and idempotency key. The controller grants a
lease only by durably consuming that exact commit. Crash recovery follows one
specified, closed reconciliation protocol.

## Revision required from P4

P4 concedes that “atomically grants leases within capacity constraints” is too
strong without a shared transaction. Its sequence becomes:

```text
frontier reducer determines structural eligibility
→ CapacityBroker commits bounded reservation
→ controller consumes commit and grants one lease
→ dispatcher records intent before external transmission
```

`K` is bounded by admissible committed reservations, including observation
freshness, uncertainty, reset windows, and stop tails—not a scalar estimate of
available capacity.

## Retained dissent

Operator attention should begin as a qualitative rate/pending-count gate rather
than pseudo-precise forecast. Not every coordinate in a resource vector has
additive conservation semantics. `HELD_AMBIGUOUS` also needs explicit human-
facing wait, independent reconciliation, operator release, or terminal
quarantine outcomes; it must never silently expire.

## Confidence

High confidence in P6's conservation posture and in the missing controller/
broker commit boundary. Medium confidence in whether the best implementation is
a protocol or a very small shared transactional nucleus.

**SEALED — P4→P6 — 2026-09-16.**
