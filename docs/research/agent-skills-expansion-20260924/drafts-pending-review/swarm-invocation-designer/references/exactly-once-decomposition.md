# Exactly-once claims need an explicit effect boundary

CloudEvents 1.0.2 defines event identity using `source` and `id`; that identity is not a
command idempotency protocol ([specification](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md)).
Kafka's documented transactional processing scope and cooperation required from external
destinations likewise matter when interpreting exactly-once claims
([Kafka 4.0 design](https://kafka.apache.org/40/design/design/)). Neither source validates
this bundle's controller design.

Use a worksheet with separate columns for event identity, operation key, attempt,
generation, target deduplication contract, effect receipt, and accounting disposition.
Several events can describe one attempt, and several attempts can concern one logical
operation. Deduplicating an event record does not undo an already repeated effect.

For a lost acknowledgement, hold capacity. A receipt must identify the exact operation
and terminal effect, not merely receipt of a request. A noncommit observation needs a
late-commit fence before a fresh attempt; alternatively an established same-operation
idempotency contract can permit retransmission. Both require authority and budget.
Unknown outcomes remain explicit. Effect-denied replay reconstructs observations and
projections; it does not prove recorded claims true or replay external effects.
