# Port Daddy IPC Interaction Protocol Layer: FIPA-Grounded Design

**Author:** Research output for Erich Owens
**Date:** 2026-03-29
**Status:** Design proposal (no code)
**Scope:** V4 Phase 4B (Binary IPC) with formal interaction protocol semantics

See full design in the agent output. Key decisions:

## Summary

### FIPA Act Mapping
- `inform`: heartbeat, notes, pheromone spray, pub/sub publish
- `request`: claim, release, lock, register, session start/end, spawn
- `query-ref`: all GET endpoints
- Missing acts to add: `not-understood`, `refuse` (distinct from `failure`), `agree` (async), `cancel`

### Four Core Protocols
1. **Agent Lifecycle**: register -> heartbeat loop -> unregister (or death -> salvage)
2. **Work Agreement**: begin -> claim files -> notes -> done (maps to Anchor Protocol)
3. **Coordination**: locks, pub/sub (FIPA-Subscribe), harbors
4. **Salvage**: death detection -> queue -> claim -> continue -> complete

### Binary IPC Frame (7-byte header)
```
[type:1][conv_id:4][payload_len:2][msgpack payload]
```
- Fire-and-forget (conv_id=0): heartbeats, pheromone sprays
- Request-response (conv_id!=0): matched by conversation ID
- 70-80% bandwidth reduction vs HTTP JSON

### Dual-Protocol Architecture
- `/tmp/port-daddy.sock` — HTTP (CLI, dashboard, SDK, MCP)
- `/tmp/port-daddy.ipc` — Binary IPC (agent heartbeats, pub/sub hot path)
- Peer credential auth on IPC socket (PID/UID, zero overhead)

### Response Semantics
Add `performative` field to all responses:
- `inform-done` (200) — action completed
- `agree` (202) — async action accepted
- `refuse` (409) — understood but declined (don't retry same params)
- `failure` (500) — tried and failed (retry with backoff)
- `not-understood` (400) — malformed (fix request)

Full design document: see agent output from 2026-03-29 session.
