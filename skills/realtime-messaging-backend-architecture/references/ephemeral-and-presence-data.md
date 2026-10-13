# Ephemeral Chat TTL Design, and Where Presence/Typing/Receipts Live

Read this when designing a chat that should expire (an event-scoped or
"party" chat), or when deciding where read receipts, typing indicators, and
presence should be stored.

## Ephemeral chat needs a schema-level TTL, not a bolted-on delete job

If a conversation shouldn't persist forever (tied to a live event, a
"room" that closes, a disappearing group), design the expiry into the
schema from the moment the conversation is created — don't add a generic
`DELETE WHERE created_at < X` cron job against the same table that holds
permanent conversations later.

Concretely (see `examples/postgres_schema_example.sql`):

- Add `conversations.expires_at` (nullable — `NULL` means permanent).
- Add a **partial index** on `expires_at WHERE expires_at IS NOT NULL` so
  the cleanup job scans only ephemeral conversations, never the whole
  table.
- Run a scheduled cleanup job (pg_cron, or an external worker) that deletes
  expired conversations and their messages in bounded batches — don't
  attempt to delete millions of rows in one transaction.
- **Skip full-text search indexing on ephemeral content.** A GIN/tsvector
  index on message body only pays for itself if the content is searchable
  long-term. Indexing content you're about to delete is write-amplification
  with no corresponding read benefit — decide this per-conversation based
  on `expires_at`, not globally.

For extremely short-lived ephemeral chat (minutes, not days/weeks), a
TTL-native store (Redis with native key expiry, or DynamoDB's TTL
attribute) can outperform Postgres-plus-cron on expiry precision — consider
it when millisecond-scale expiry timing actually matters to the product,
not as a default.

## Read receipts, typing indicators, and presence: usually NOT in the messages table

These are separate, higher-churn, more-ephemeral data than the messages
themselves, and they belong in a fast key-value/in-memory store (Redis),
not the durable, WAL-logged, indexed table holding message history:

- **Typing indicators**: fire many times per second per active typer and
  are irrelevant a few seconds later. Model as a short-TTL key, e.g.
  `typing:{conversation_id}:{user_id}` with a ~5 second TTL renewed on
  each keystroke event (debounced client-side). No durability guarantee
  needed — if Redis restarts and loses it, nothing of value was lost.
- **Presence** (online/offline/last-active): similarly high-churn —
  heartbeats every few seconds per connected user. Model as
  `presence:{user_id}` with a TTL slightly longer than the heartbeat
  interval; absence of the key means offline.
- **Per-recipient delivery/read receipts in a group** (did each of N
  members see this specific message): high cardinality (message × member)
  and high churn. Redis (or your managed realtime backend's built-in
  presence/receipt feature, per
  `references/managed-realtime-tradeoffs.md`) is the right home.

**One deliberate exception**: a coarse, per-user "last read message"
*cursor* for a conversation (not a per-message receipt) changes only once
per read session, not continuously. That low churn makes it fine to keep
as a column in Postgres (`conversation_members.last_read_message_id` in
the example schema) if you want it to survive a Redis restart or need it
in the same transaction as another durable write. The distinction that
matters is churn rate and durability need, not "is this receipt-shaped
data" — see the anti-pattern in SKILL.md for the failure mode of getting
this backwards.
