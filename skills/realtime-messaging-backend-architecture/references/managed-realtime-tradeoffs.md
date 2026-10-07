# Managed Realtime Backends: Supabase Realtime, Ably, PubNub

Read this when deciding whether to own the WebSocket fan-out/presence
infrastructure yourself or buy it, and which managed option fits your
primary database choice.

## What "managed realtime" trades away

All three options below trade infrastructure ownership for velocity: they
handle WebSocket fan-out and presence/typing-indicator plumbing so your
team only models data and business logic. None of them replace the durable
message store designed in `references/postgres-message-schema.md` — they
sit on top of it as the delivery layer. Implementing this fan-out yourself
with raw WebSockets is the `websocket-realtime-expert` skill's territory,
not this one.

## Supabase Realtime

Taps Postgres's own logical replication (WAL) stream and pushes changes to
subscribed clients over WebSockets.

**Pick this when**: you're already on Postgres (which, per this skill's
default, you should be) and want realtime delivery without standing up a
separate message bus or pub/sub service. You get change-data-capture-style
delivery "for free" off infrastructure you already operate.

**Costs to plan for**:
- Fan-out load rides on your primary database's replication stream —
  bursty realtime traffic can pressure the same infrastructure serving
  your transactional writes if not isolated (replication slots, dedicated
  read replicas for the realtime service).
- You're coupling your realtime delivery mechanism to your database choice.
  If you ever migrate off Postgres (per the wide-column reference), your
  realtime layer migrates with it.
- Publication/replication-slot configuration is a real operational surface
  you now own, even though it's lighter than a fully separate bus.

## Ably / PubNub

Backend-agnostic pub/sub-as-a-service. Your API publishes messages to
named channels; the vendor handles WebSocket fan-out, connection scaling,
and typically ships built-in presence and typing-indicator primitives.

**Pick this when**: you want zero self-hosted realtime infrastructure
regardless of your primary database, need global points of presence /
enterprise SLAs, or your data layer isn't Postgres (or might change).

**Costs to plan for**:
- Per-connection / per-message pricing that scales with concurrent users —
  model this against your growth projection, not just current traffic.
- Another vendor dependency and another data path to reason about during
  incidents (is it the app, the database, or the realtime vendor?).
- These services are **transport/fan-out layers, not source-of-truth
  stores** — you still need the durable schema from
  `references/postgres-message-schema.md`; Ably/PubNub's own message
  history/persistence features are not a substitute for your primary
  database's transactional guarantees on edits, deletes, and moderation.

## Decision shortcut

| Already on Postgres? | Need vendor-agnostic / multi-DB? | Pick |
|---|---|---|
| Yes | No | Supabase Realtime |
| Yes | Yes (e.g. planning a wide-column migration) | Ably / PubNub |
| No / other primary DB | — | Ably / PubNub |
| Want full control, have the team to run it | — | Roll your own — see `websocket-realtime-expert` |
