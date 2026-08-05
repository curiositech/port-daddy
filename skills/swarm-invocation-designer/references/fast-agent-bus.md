# Fast Agent Bus

Use this when choosing how agents communicate.

## Two-Plane Architecture

| Plane | Goal | Examples | Persist? |
| --- | --- | --- | --- |
| Hot path | fast steering and presence | in-process event emitter, Unix domain socket, loopback WebSocket, gRPC, NATS, Redis Streams, shared-memory ring | no, summarize later |
| Durable path | audit, replay, receipts | Port Daddy notes, tuples, tubes, transcripts, append log, D1/R2/relay, PR comments | yes |

Do not force one transport to do both jobs. Hot path is allowed to drop replaceable presence messages. Durable path must be replayable and signed or attributable.

## Latency Guidance

- Human-visible live board: p95 under 250 ms feels responsive.
- Agent steering: p95 under 100 ms is usually enough because model/tool turns dominate.
- Local IPC: target under 10 ms per hop.
- WebSocket/gRPC loopback: target under 25 ms per hop.
- Durable append: target under 500 ms per checkpoint; do not block cancel/pause on it.

## Message Shape

Keep hot messages tiny:

```json
{
  "conversation_id": "swarm-123",
  "role": "tester",
  "kind": "heartbeat",
  "state": "running-tests",
  "seq": 42,
  "ts": "2026-07-03T00:00:00Z"
}
```

Put bulky data elsewhere:

- transcript chunk
- command output
- patch
- screenshot
- test artifact
- PR review

Hot message carries a content address or artifact id, not the artifact body.

## ICP / IPC Decision

- Use local IPC or regional message buses for live steering.
- Use Internet Computer canisters or comparable consensus systems for identity, settlement, cross-org receipts, governance, or notarization.
- Commit signed checkpoints from hot path to durable path at state transitions: launched, claimed, blocked, review-ready, done, abandoned.

## Failure Semantics

Every protocol must define:

- duplicate message handling
- out-of-order handling
- timeout and stale heartbeat
- cancellation acknowledgement
- claim rejection
- spend cap breach
- unsafe command refusal
- linked successor continuation after orphaning
