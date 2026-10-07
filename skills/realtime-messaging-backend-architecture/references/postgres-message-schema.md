# Postgres Message Schema: The Default Starting Point

Read this when you're standing up the durable storage for a new DM/group-chat
feature and need the actual table shapes and index choices, not just the
top-level "use Postgres" recommendation.

## Why Postgres first

A `messages` table partitioned/indexed by `conversation_id` + `created_at`
handles very substantial read/write volume with proper indexing. The hot
query for a chat product is almost always "give me the last N messages in
conversation X" — that's a single index scan on
`(conversation_id, created_at DESC)`, not a join-heavy query. Postgres
answers it in single-digit milliseconds at volumes far beyond what most
products ever reach.

The feature that actually distinguishes chat products — message edits,
deletes, moderation actions, and coordinating a read cursor with a delivery
event — needs transactional (ACID) guarantees. Doing "edit this message AND
update the read cursor AND clear a moderation flag" atomically is trivial in
Postgres and awkward-to-impossible with real correctness guarantees on an
eventually-consistent wide-column store. Don't give up transactions until
you have evidence you need to.

See `examples/postgres_schema_example.sql` for the full concrete schema
referenced below.

## Table shape

- `conversations` — one row per DM or group; carries `kind`, `expires_at`
  (ephemeral chat support — see `references/ephemeral-and-presence-data.md`),
  and `delivery_mode` (see `references/fanout-strategies.md`).
- `conversation_members` — membership plus a **coarse, low-churn** last-read
  cursor (`last_read_message_id`). This is not the same thing as per-message
  read receipts in a large group, and it is not typing/presence — see the
  anti-pattern in SKILL.md about conflating these.
- `messages` — partitioned by range on `created_at`. Primary key includes
  the partition key (`conversation_id, created_at, id`) because Postgres
  range partitioning requires the partition key in any unique/primary key.

## Partitioning

Partition `messages` by `created_at` range (monthly is a reasonable default
cadence for most products; move to weekly only once monthly partitions are
provably too large for your maintenance windows). Benefits:

- Old partitions can be dropped or archived to cold storage cheaply for
  retention policies — no `DELETE ... WHERE` scan across billions of rows.
- Autovacuum and index maintenance scope shrinks to a partition at a time
  instead of the whole table.
- Ephemeral conversations (see the ephemeral reference) can sometimes be
  dropped a whole partition at a time if you bucket them separately.

Automate partition creation with `pg_partman` or a scheduled job — don't
hand-roll monthly `CREATE TABLE ... PARTITION OF` statements as a manual
ritual; that's how you find out in month 13 that nobody made a partition for
month 13.

## Indexing

- `(conversation_id, created_at DESC)` — the one index nearly every chat
  read path needs. Put it on every partition (partitioned indexes handle
  this automatically in modern Postgres).
- Do **not** add a full-text (GIN/tsvector) index on message body by
  default. Only add it for conversations that are actually searchable
  long-term (`expires_at IS NULL`) — see the ephemeral reference for why
  indexing content that will be deleted is pure waste.
- Avoid indexing high-cardinality, rarely-queried columns "just in case."
  Every index is write-amplification on every message insert.

## First scaling levers, before you reach for a different database

In order of cost, before concluding Postgres itself is the bottleneck:

1. **Read replicas** for read-heavy paths (history scrollback, search)
   while writes stay on the primary.
2. **Connection pooling** (PgBouncer/Supavisor) — connection exhaustion is
   frequently mistaken for a throughput ceiling.
3. **Query/index review** — an unindexed join or an N+1 query pattern in
   application code masquerades as "the database can't keep up."
4. **Sharding extensions** (e.g. Citus) if you outgrow a single primary for
   writes but still want SQL/joins/transactions.

Only after these are genuinely exhausted — with metrics showing it, not a
hunch — does `references/scaling-beyond-postgres.md` become relevant.
