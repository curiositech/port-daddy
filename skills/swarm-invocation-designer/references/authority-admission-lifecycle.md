# Authority, admission, and lifecycle

The planning graph has no execution authority. An external controller evaluates
eligibility, consumes a broker-owned single-use reservation commit, records
durable dispatch intent, then issues one fenced lease. Workers cannot perform
those transitions.

Every capacity-bearing continuation gets a fresh binding to plan digest,
revision, node, attempt, body generation, route, resource vector, expiry, and
idempotency key. Crash, cancellation, expiry, reduction, and ambiguity end in
`SETTLED`, `RELEASED`, or `HELD_AMBIGUOUS` before reuse.

Cancellation separates request, acknowledgement, fence, termination witness,
provider reconciliation, and reservation disposition. Missing evidence never
becomes optimistic release.
