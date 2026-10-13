# Realtime Messaging Backend Architecture — Changelog

## v1.0.0 (2026-09-19)

- Initial skill creation.
- Core decision tree: Postgres vs. wide-column (Cassandra/ScyllaDB) vs.
  managed realtime (Supabase Realtime / Ably / PubNub), and fan-out-on-write
  vs. fan-out-on-read.
- Reference files: Postgres schema design, scaling-beyond-Postgres
  migration guidance, managed-realtime tradeoffs, fan-out strategies,
  ephemeral/TTL chat design and presence/typing/receipt placement.
- Concrete example: `examples/postgres_schema_example.sql`.
- Four anti-patterns encoded: premature wide-column migration, typing/
  presence in the durable table, bolted-on ephemeral deletion, and uniform
  fan-out-on-write regardless of group size.
