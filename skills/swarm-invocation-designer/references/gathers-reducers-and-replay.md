# Gathers, reducers, review, and replay

A gather seals exact members and policy (`ALL`, `QUORUM`, or
`DEADLINE_PARTIAL`). Semantic closure may preserve partial results while absent
members remain capacity-bearing until their attempts terminate or reconcile.

Reducers are immutable by version and implementation digest. They consume a
declared ordering of artifact hashes, not mutable transcripts. A decisive
reviewer is separate from result producers. One rework creates a new attempt;
further rework escalates or halts.

Replay is projection reconstruction. It denies effects and compares terminal,
gather, reducer, reservation, and ambiguity projections to recorded digests.
