# Scaling Beyond Postgres: Wide-Column Stores

Read this when you have actual evidence — not a hunch — that a well-tuned
Postgres (with read replicas and/or sharding) cannot sustain your write
throughput, and you're evaluating Cassandra or ScyllaDB as a migration
target.

## Evidence, not vibes

Before treating this as your problem, confirm all of the following:

- Write latency degrades under **legitimate** load (not an unindexed query,
  not connection-pool exhaustion, not a runaway N+1 from application code —
  rule these out first, per `references/postgres-message-schema.md`).
- You've already added read replicas for read-heavy paths and the write
  path itself — not reads — is the constraint.
- The constraint is structural: Postgres has a single writer per shard/
  primary. If you've sharded (e.g. with Citus) and are still write-bound
  across shards, that's real evidence.
- The growth trajectory is durable (sustained product growth), not a single
  traffic spike you could absorb with caching or backpressure.

Most chat products never hit this wall. Treat this section as a **migration
to plan for when the evidence arrives**, not a default architecture to start
with. Starting here on day one buys you all of the operational cost below
for scale you may never reach.

## Why the wide-column data model fits once you're actually here

Cassandra/ScyllaDB's data model naturally fits "append-only log per
conversation partition": partition key = `conversation_id`, clustering key
= `created_at`/message id, descending. Writes to different partitions
(different conversations) land on different nodes with no cross-partition
coordination, so write throughput scales roughly linearly by adding nodes —
something a single-primary Postgres fundamentally cannot do for writes to
the same logical table.

## The real operational cost

This is a genuine architectural shift, not a drop-in replacement:

- **Multi-node cluster management**: replication factor, consistency
  levels per query, compaction strategy tuning, repair scheduling. This is
  a standing operational burden, not a one-time setup cost.
- **Eventual consistency tradeoffs**: a message write may not be
  immediately visible to a read at a different consistency level. Chat
  features that assumed "read your own write" now need explicit
  consistency-level choices (e.g. `QUORUM` writes + `QUORUM` reads), which
  cost latency.
- **No ad-hoc joins, no cheap secondary indexes**: every query pattern
  needs its own denormalized table (e.g. a separate "conversations by user"
  table maintained by the application, not the database). Adding a new
  query pattern later means a new denormalized table and a backfill, not a
  new index.
- **Multi-row transactions are gone or severely limited**: the
  edit/delete/moderation transactional guarantees that Postgres gives for
  free (see the schema reference) need to be re-implemented at the
  application level, if they're achievable at all.

## Migration shape, when you actually do it

1. **Dual-write**: write new messages to both Postgres and the wide-column
   store while reads still come from Postgres. Validate parity.
2. **Backfill**: batch-copy historical messages into the wide-column store,
   partitioned the same way (per `conversation_id`).
3. **Cutover per shard/conversation-range**: move read traffic over
   incrementally, not as a single flag flip, so you can roll back a slice
   at a time if something's wrong.
4. **Decommission** the Postgres write path only after the new store has
   run at full read+write traffic for a sustained period with no
   correctness regressions.

Do not attempt a big-bang cutover. The dual-write period is where you find
out which of your query patterns quietly depended on a join, a
transaction, or a secondary index you haven't rebuilt yet.
