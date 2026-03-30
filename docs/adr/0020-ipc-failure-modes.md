# ADR 0020: IPC Binary Protocol Failure Modes and Mitigations

**Status:** Accepted
**Date:** 2026-03-30
**Authors:** Erich Owens, Claude
**Scope:** Phase 4B — Binary IPC over Unix Domain Sockets

## Context

Port Daddy v3.8 adds a binary IPC protocol alongside the existing HTTP API. The IPC socket (`/tmp/port-daddy.ipc`) handles high-frequency agent operations: heartbeats, pheromone sprays, pub/sub publish, and channel subscriptions. This ADR documents every failure mode we identified and how we designed around each one.

## Failure Taxonomy

### 1. Dead Subscriber (Agent Crash)

**Scenario:** Agent subscribes to `build:done`, then crashes (SIGKILL, OOM, context window exceeded).

**Risk:** Zombie subscription callback in `messaging.subscribe()` tries to push frames to a dead socket. Memory leak. Silent frame drops.

**Mitigation:**
- Per-connection subscription tracking: `conn.subscriptions[]` stores `{ channel, unsub }` pairs
- On `socket.close` event: iterate all subscriptions, call every `unsub()` function
- Subscriptions die with the connection — no zombies possible
- **Test:** `server cleans up subscriptions on client disconnect` verifies all 3 unsub() calls fire

### 2. Reconnect Without Re-subscribe

**Scenario:** IPC connection drops (network blip, daemon restart). Agent reconnects via auto-reconnect. But the server-side subscriptions are gone (connection was closed). Agent thinks it's still subscribed.

**Risk:** Agent misses all messages between disconnect and manual re-subscribe. Could miss critical coordination signals.

**Mitigation:**
- Client tracks `activeSubscriptions: Set<string>` locally
- On reconnect: client replays all subscriptions automatically in the connect callback
- **Code:** `ipc-client.ts` line 87 — replay loop runs after socket connects

### 3. Lock Holder Dies

**Scenario:** Agent holds lock `db-migrations`, heartbeating over IPC. Agent crashes. Lock has TTL but daemon doesn't know agent is dead until heartbeat timeout expires.

**Risk:** Lock held by dead agent for up to 2 minutes (DEFAULT_AGENT_TTL). Other agents blocked.

**Mitigation:**
- On IPC disconnect: `server.ts` eagerly releases all locks owned by disconnected agent's `agentId`
- Runs `locks.list({ owner: agentId })` then `locks.release()` for each
- Faster than waiting for heartbeat timeout + TTL expiry
- **Code:** `server.ts` onDisconnect handler

### 4. Backpressure / Slow Subscriber

**Scenario:** Agent A subscribes to `telemetry`. Agent B publishes 1000 messages/sec. Agent A can't keep up — its socket buffer fills.

**Risk:** `socket.write()` returns `false` (Node.js kernel buffer full). Continued writes queue in memory. OOM or frame loss.

**Mitigation:**
- `safeWrite()` checks `socket.write()` return value
- When false: frames queue in `conn.writeQueue` (max 64 frames)
- `drain` event flushes queue
- Queue overflow: frame dropped, `conn.framesDropped` incremented, error logged
- **Not implemented yet:** FAILURE frame to subscriber notifying of dropped messages

### 5. Rate Flooding

**Scenario:** Malicious or buggy agent sends 10,000 frames/sec.

**Risk:** Server CPU exhaustion processing frames. Starvation of other agents.

**Mitigation:**
- Per-connection rate limit: 500 frames/sec (configurable)
- Rate window: 1-second sliding window
- Over-limit requests: REFUSE with `error: 'rate_limited'`
- Over-limit fire-and-forget: silently dropped (no response to send)
- **Test:** `server rate-limits: at least 1 succeeds, excess get REFUSE`

### 6. Protocol Violations (Malformed Frames)

**Scenario:** Agent sends garbage bytes, corrupted msgpack, or oversized payloads.

**Risk:** Decoder crash, buffer corruption, memory exhaustion.

**Mitigation:**
- 3-strike violation budget per connection
- Malformed msgpack: frame skipped, NOT_UNDERSTOOD sent, violation counted
- Oversized payload in decoder: frame skipped, violation counted
- 3rd violation: `disconnectWithReason()` sends REFUSE then destroys socket
- **Test:** `skips frame with malformed msgpack payload` (frame.test.js)

### 7. Connection Exhaustion (fd Starvation)

**Scenario:** 300 agents connect simultaneously. Server runs out of file descriptors.

**Risk:** `accept()` fails, new agents can't connect. Daemon appears down.

**Mitigation:**
- `MAX_CONNECTIONS = 256` (configurable via `maxConnections`)
- Connection over limit: server sends REFUSE frame then `socket.destroy()`
- **Test:** `server rejects connections over max limit`

### 8. Stale Socket File

**Scenario:** Daemon crashes without calling `unlinkSync()`. Socket file `/tmp/port-daddy.ipc` remains. New daemon can't bind.

**Risk:** Daemon fails to start. User must manually delete socket file.

**Mitigation:**
- `ipc-server.ts` `start()`: `if (existsSync(socketPath)) unlinkSync(socketPath)` before binding
- Same pattern used by the HTTP socket
- `chmod 0o600` after binding (owner-only permissions)

### 9. Subscribe Storm on Reconnect

**Scenario:** Agent with 20 subscriptions disconnects and reconnects. Replay sends 20 SUBSCRIBE frames in burst.

**Risk:** If old subscriptions weren't cleaned up server-side, agent has 40 subscriptions (20 zombie + 20 new).

**Mitigation:**
- Server-side: old connection's subscriptions are cleaned up in `socket.close` handler (see #1)
- New connection gets a clean `subscriptions: []` array
- Duplicate subscribe on same connection: handler returns `existing: true`, doesn't create second callback
- **Test:** `msg.subscribe returns existing:true for duplicate subscription`

### 10. Fire-and-Forget is Not Lossy

**Decision:** Unlike UDP, Unix domain sockets are reliable ordered byte streams. We never silently drop frames at the transport level. `socket.write()` either succeeds (data in kernel buffer) or returns false (backpressured — data is still buffered by Node.js, just slower).

The ONLY place frames are dropped is:
- Write queue overflow (MAX_WRITE_QUEUE = 64) during severe backpressure
- Rate limiting (>500 frames/sec)

Both are logged and tracked via `conn.framesDropped`.

### 11. Lock Acquire Over Fire-and-Forget

**Scenario:** Agent sends `lock.acquire` as a fire-and-forget INFORM with `convId=0`.

**Risk:** No response comes back. Agent doesn't know if it holds the lock. Proceeds as if it does. Data corruption.

**Mitigation:**
- Lock acquire is mapped to `IpcAction.LOCK_ACQUIRE` which the router handles as any other action
- When `convId=0`, the router returns no reply — the agent gets no confirmation
- **This is by design:** fire-and-forget is for operations where confirmation isn't needed (heartbeats, sprays)
- The SDK always sends lock operations as REQUEST (convId≠0) via `client.request()`
- Auth: `lock.acquire` is in `REQUIRES_REGISTRATION` — only registered agents can acquire

### 12. Permission Escalation via Self-Reported agentId

**Scenario:** Agent A connects, claims agentId of Agent B. Acquires B's locks, reads B's session.

**Risk:** Identity spoofing on localhost.

**Current mitigation (v3.8):**
- Socket file is `chmod 0o600` — only the socket owner's processes can connect
- Same user = same trust boundary (consistent with the HTTP socket model)
- `agentId` is trust-on-first-frame — the first frame's `agentId` becomes the connection's identity

**Future mitigation (v4):**
- SO_PEERCRED / LOCAL_PEERCRED: extract PID from socket, cross-reference with registered agent's PID
- Requires native addon (`unix-socket-credentials`) or Rust FFI

## Decision

We accept these mitigations as sufficient for v3.8. The attack surface is localhost-only, same-user. The biggest risk is operational (dead subscribers, stale locks) not adversarial. All operational risks have automated cleanup.

## Consequences

- Every IPC connection has ~200 bytes of overhead (subscription array, counters, decoder state)
- Lock release on disconnect adds ~1ms of SQLite work per disconnect
- Subscription replay on reconnect adds a burst of frames (bounded by subscription count)
- Rate limiting may cause agents to miss events if they exceed 500 frames/sec (they should use subscription for persistent streams, not polling)
