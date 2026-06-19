# ADR 0020: IPC Binary Protocol Failure Modes and Mitigations

**Status:** Accepted
**Date:** 2026-03-30
**Updated:** 2026-03-30 (post-security-audit, post-research)
**Authors:** Erich Owens, Claude
**Scope:** Phase 4B — Binary IPC over Unix Domain Sockets

## Context

Port Daddy v3.8 adds a binary IPC protocol alongside the existing HTTP API. The IPC socket (`/tmp/port-daddy.ipc`) handles high-frequency agent operations: heartbeats, pheromone sprays, pub/sub publish, and channel subscriptions. This ADR documents every failure mode identified across three analysis passes: design review, security audit, and Unix domain socket research.

## Failure Taxonomy

### Category A: Agent Lifecycle Failures

#### 1. Dead Subscriber (Agent Crash)

**Scenario:** Agent subscribes to `build:done`, then crashes (SIGKILL, OOM, context window exceeded).

**Risk:** Zombie subscription callback pushes frames to dead socket. Memory leak.

**Mitigation:**
- Per-connection subscription tracking: `conn.subscriptions[]` stores `{ channel, unsub }` pairs
- On `socket.close` event: iterate all subscriptions, call every `unsub()` function
- Subscriptions die with the connection — no zombies possible
- **Test:** `server cleans up subscriptions on client disconnect` — verifies all 3 unsub() calls fire
- **Test:** `msg.subscribe wires into messaging.subscribe and tracks on connection`

#### 2. Reconnect Without Re-subscribe

**Scenario:** IPC connection drops. Agent reconnects. Server-side subscriptions are gone. Agent thinks it's still subscribed.

**Risk:** Agent misses messages between disconnect and re-subscribe.

**Mitigation:**
- Client tracks `activeSubscriptions: Set<string>` locally
- On reconnect: client replays all subscriptions automatically
- **Code:** `ipc-client.ts` — replay loop in connect callback

#### 3. Lock Holder Dies

**Scenario:** Agent holds lock `db-migrations`, crashes. Lock has TTL.

**Risk:** Lock held by dead agent for up to 2 minutes.

**Mitigation:**
- On IPC disconnect: `server.ts` eagerly releases all locks owned by disconnected agent
- Runs `locks.list({ owner: agentId })` then `locks.release()` for each
- Failure logged (not silently swallowed)
- Faster than waiting for heartbeat timeout + TTL expiry

#### 4. Subscribe Storm on Reconnect

**Scenario:** Agent with 20 subscriptions reconnects. Replay sends 20 SUBSCRIBE frames.

**Risk:** Duplicate subscriptions (20 zombie + 20 new).

**Mitigation:**
- Server: old connection's subscriptions cleaned up in close handler (#1)
- New connection: clean `subscriptions: []` array
- Duplicate subscribe on same connection: returns `existing: true`
- Subscription limit: 64 per connection (prevents memory exhaustion)
- **Test:** `msg.subscribe returns existing:true for duplicate subscription`

### Category B: Transport & Protocol Failures

#### 5. Backpressure / Slow Subscriber

**Scenario:** Agent A subscribes to `telemetry`. Agent B publishes 1000 messages/sec.

**Risk:** Socket buffer fills. OOM or frame loss.

**Mitigation:**
- `safeWrite()` checks `socket.write()` return value
- Backpressured: frames queue in `conn.writeQueue` (max 64 frames)
- `drain` event flushes queue
- Queue overflow: frame dropped, `conn.framesDropped` incremented, error logged
- **Note:** Unix domain sockets are reliable byte streams. `socket.write()` returning false means data IS buffered by Node.js, just slower. The ONLY place we drop is write queue overflow.

#### 6. Rate Flooding

**Scenario:** Malicious or buggy agent sends 10,000 frames/sec.

**Risk:** Server CPU exhaustion. Starvation of other agents.

**Mitigation:**
- Per-connection rate limit: 500 frames/sec (configurable)
- Over-limit requests: REFUSE with `error: 'rate_limited'`
- Over-limit fire-and-forget: silently dropped
- **Test:** `server rate-limits: at least 1 succeeds, excess get REFUSE` — verifies >= 1 success AND > 0 REFUSE

#### 7. Protocol Violations (Malformed Frames)

**Scenario:** Garbage bytes, corrupted msgpack, oversized payloads, invalid performative codes.

**Risk:** Decoder crash, buffer corruption.

**Mitigation:**
- 3-strike violation budget per connection
- Malformed msgpack: frame skipped, NOT_UNDERSTOOD sent, violation counted
- Unknown performative type code: frame skipped (VALID_TYPES set check)
- 3rd violation: `disconnectWithReason()` sends REFUSE then destroys socket
- **Test:** `skips frame with malformed msgpack payload` — garbage frame skipped, next valid frame decoded
- **Test:** `all 13 performative types survive encode/decode` — count guard prevents silent additions

#### 8. Head-of-Line Blocking

**Scenario:** Synchronous SQLite handler takes too long, blocking all connections.

**Risk:** All IPC processing stalls in single-threaded Node.js event loop.

**Mitigation:**
- Router handlers call synchronous better-sqlite3 methods (fast, deterministic)
- Fire-and-forget path returns immediately
- **Deferred:** Per-handler timeout/watchdog for observability

#### 9. Connect Timeout

**Scenario:** Server's listen backlog full. Client `connect()` hangs indefinitely.

**Risk:** Agent blocks forever waiting for IPC. Misses coordination deadlines.

**Mitigation:**
- Client connect() has timeout (default: `requestTimeout` ms, typically 5000)
- Timeout cleared on both success and error paths
- On timeout: socket destroyed, error thrown
- **Source:** Node.js issue #4785 (connect over UDS hangs indefinitely)

### Category C: Filesystem & OS Failures

#### 10. Stale Socket File

**Scenario:** Daemon crashes without `unlinkSync()`. Socket file remains.

**Risk:** New daemon gets `EADDRINUSE`.

**Mitigation:**
- `ipc-server.ts` `start()`: unlinks stale socket before binding
- Shutdown handler also cleans up
- **Gap (v4):** No lockfile to prevent concurrent daemon instances racing to delete each other's socket

#### 11. TOCTOU Permission Race (CVE-2000-0864 class)

**Scenario:** Socket created with default permissions. Between `bind()` and `chmod()`, any local process can connect.

**Risk:** Unauthorized process connects during microsecond window.

**Mitigation:**
- `process.umask(0o077)` set BEFORE `server.listen()`, restored after
- Belt-and-suspenders `chmod(0o600)` after bind
- chmod failure logged (not silently swallowed)
- **Source:** CVE-2000-0864, chrony-dev socket race discussion

#### 12. Socket File Deleted While Running

**Scenario:** Another process or cleanup script deletes `/tmp/port-daddy.ipc` while daemon is running.

**Risk:** Existing connections continue working. New agents get ENOENT. Daemon silently unreachable.

**Mitigation (current):**
- Client auto-reconnect with exponential backoff
- Socket recreated on daemon restart

**Deferred (v4):**
- `fs.watch()` on socket path to detect deletion and re-bind
- Or: move socket to a stable directory not subject to `/tmp` cleanup

#### 13. Socket Path Length

**Scenario:** `PORT_DADDY_IPC` env var set to a deeply nested path exceeding kernel limit.

**Risk:** Silent bind failure on macOS (104 byte limit) or Linux (108 byte limit).

**Mitigation:**
- Server validates `socketPath.length < MAX_SOCKET_PATH` before binding
- Platform-aware: 104 on darwin, 108 on linux
- Clear error message on failure

#### 14. File Descriptor Exhaustion

**Scenario:** 256 IPC connections + HTTP socket + TCP socket + SQLite + logs = near `ulimit -n`.

**Risk:** `EMFILE` error, daemon can't accept new connections.

**Mitigation:**
- `MAX_CONNECTIONS = 256` hard cap with REFUSE for excess
- macOS default `ulimit -n` is 256 (soft limit)
- **Action needed:** launchd plist should set `SoftResourceLimits.NumberOfFiles` to at least 1024

### Category D: Security Failures

#### 15. Identity Spoofing via Self-Reported agentId

**Scenario:** Agent A claims to be Agent B. Acquires B's locks, reads B's session.

**Risk:** Identity spoofing on localhost.

**Current mitigation (v3.8):**
- Socket file `chmod 0o600` — only socket owner's processes can connect
- `agentId` trust-on-first-frame — locked to connection after first frame
- `REQUIRES_REGISTRATION` gate on sensitive actions (sessions, locks, salvage)
- Port claims intentionally excluded from registration requirement (backward compat)

**Future mitigation (v4):**
- SO_PEERCRED / LOCAL_PEERCRED via native addon
- PID-bound agent registration (agent "foo" registered by PID 1234, reject from PID 5678)

#### 16. Subscription Resource Exhaustion

**Scenario:** Agent subscribes to 100,000 distinct channels.

**Risk:** Memory exhaustion, CPU amplification on publish.

**Mitigation:**
- `MAX_SUBSCRIPTIONS = 64` per connection
- Excess subscriptions: handler returns `{ subscribed: false, error: 'subscription_limit' }`
- HTTP layer has equivalent limit

#### 17. Input Validation Bypass

**Scenario:** IPC path bypasses HTTP middleware (Express/Fastify validation). Malformed payload fields reach service layer.

**Risk:** SQLite errors, data corruption, unexpected behavior.

**Mitigation:**
- Scalar fields: `String(p.foo)` coercion (safe — returns "undefined" for undefined)
- Array fields: `asStringArray()` validator rejects non-string arrays
- `paths` field validated before passing to `sessions.claimFiles()`/`releaseFiles()`

#### 18. Error Message Information Disclosure

**Scenario:** Handler throws with stack trace. Full error sent to client.

**Risk:** Internal file paths, SQL fragments leaked.

**Mitigation (current):**
- Localhost-only, same-user trust boundary
- `String(err)` sent in FAILURE responses

**Deferred (v4):**
- Sanitize error messages to generic codes
- Log full errors server-side only

#### 19. API Surface Enumeration

**Scenario:** Client sends unknown action, server returns list of all available actions.

**Risk:** Reconnaissance of IPC API surface.

**Mitigation:**
- `available` actions list REMOVED from NOT_UNDERSTOOD response
- Error only includes the unknown action name
- **Test:** `NOT_UNDERSTOOD for unknown action` — verifies `available` is undefined

#### 20. Lock Acquire as Fire-and-Forget

**Scenario:** Agent sends `lock.acquire` with `convId=0`.

**Risk:** No confirmation. Agent proceeds without knowing if lock is held.

**Mitigation:**
- By design: fire-and-forget is for idempotent operations only
- SDK always uses `request()` (convId≠0) for lock operations
- `lock.acquire` in `REQUIRES_REGISTRATION` — only registered agents can acquire

## Decision

We accept these mitigations as sufficient for v3.8. The attack surface is localhost-only, same-user. The biggest risk is operational (dead subscribers, stale locks) not adversarial. All operational risks have automated cleanup.

## Test Coverage

| Failure Mode | Test(s) |
|-------------|---------|
| Dead subscriber (#1) | `server cleans up subscriptions on client disconnect` |
| Subscribe tracking (#2) | `client subscribe() tracks subscriptions for reconnect replay` |
| Duplicate subscribe (#4) | `msg.subscribe returns existing:true for duplicate subscription` |
| Subscribe wiring (#1) | `msg.subscribe wires into messaging.subscribe and tracks on connection` |
| Subscribe push (#1) | `msg.subscribe callback pushes INFORM frames to subscriber socket` |
| Unsubscribe (#4) | `msg.unsubscribe removes subscription and calls unsub function` |
| Unsubscribe nonexistent | `msg.unsubscribe on non-existent channel returns not_subscribed` |
| Backpressure (#5) | `client send() returns true when connected, false when not` |
| Rate limiting (#6) | `server rate-limits: at least 1 succeeds, excess get REFUSE` |
| Malformed frames (#7) | `skips frame with malformed msgpack payload` |
| Performative validation (#7) | `all 13 performative types survive encode/decode` |
| Connection limit (#14) | `server rejects connections over max limit` |
| Request timeout (#9) | `request timeout: server does not reply` |
| Pending rejection (#3) | `client pending requests rejected on disconnect` |
| Handler error (#20) | `server handler error sends FAILURE response` |
| F&F error silence (#20) | `handler throw on fire-and-forget does NOT send reply` |
| Auth gate (#15) | `REFUSE when unregistered agent tries protected action` |
| Auth pass (#15) | `registered agent passes auth gate for session.begin` |
| API enumeration (#19) | `NOT_UNDERSTOOD for unknown action` — available undefined |
| Input validation (#17) | `session.files.claim passes paths array` |
| Diagnostics (#5) | `server connection diagnostics track bytes and frames` |

## Deferred to v4

1. SO_PEERCRED / LOCAL_PEERCRED peer credential extraction
2. PID-bound agent registration
3. Socket file existence monitoring (fs.watch)
4. Lockfile for concurrent daemon instance prevention
5. Per-handler timeout/watchdog
6. Error message sanitization
7. Move socket from `/tmp` to stable directory

## Consequences

- Every IPC connection has ~300 bytes of overhead (subscription array, counters, decoder state, write queue)
- Lock release on disconnect adds ~1ms of SQLite work per disconnect
- Subscription replay on reconnect adds a burst of frames (bounded by 64)
- Rate limiting may cause agents to miss events if they exceed 500 frames/sec
- Subscription limit of 64 per connection may need adjustment for large fleet deployments
- Socket path must be < 104 bytes on macOS
