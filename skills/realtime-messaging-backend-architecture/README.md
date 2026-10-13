# Realtime Messaging Backend Architecture

Chooses and designs the backend data-model and storage architecture for
chat/messaging features (1:1 DMs and group chat) at social-app scale.

## Structure

```
realtime-messaging-backend-architecture/
├── SKILL.md                                   # Core decision tree + anti-patterns (<500 lines)
├── CHANGELOG.md                               # Version history
├── README.md                                  # This file
├── references/
│   ├── postgres-message-schema.md             # Table shapes, partitioning, indexing
│   ├── scaling-beyond-postgres.md             # Wide-column migration evidence bar + shape
│   ├── managed-realtime-tradeoffs.md          # Supabase Realtime vs. Ably vs. PubNub
│   ├── fanout-strategies.md                   # Push vs. pull delivery design
│   └── ephemeral-and-presence-data.md         # TTL chat design + Redis for receipts/typing/presence
└── examples/
    └── postgres_schema_example.sql            # Concrete starting schema
```

## Quick Start

1. Read SKILL.md for the core decision tree (store choice + fan-out
   strategy).
2. Pull the relevant reference file for the decision you're actually
   making — they are not loaded automatically.
3. Copy `examples/postgres_schema_example.sql` as a starting point for a
   new chat feature's schema.

## Scope

This skill covers the backend **data-model/storage** decision for chat.
It explicitly does not cover the WebSocket transport layer
(`websocket-realtime-expert`) or CRDT-based collaborative document editing
(`real-time-collaboration-engine`) — see SKILL.md's NOT-for section.
