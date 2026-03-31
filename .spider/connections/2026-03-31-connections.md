# Spider Connections — 2026-03-31

> **Spider** is the connection engine for Port Daddy. This file records syllogisms: pairs (or triples) of *already-shipped* features whose composition implies a new, unbuilt capability.
>
> Format: PREMISE A / PREMISE B / THEREFORE / CONFIDENCE / EFFORT / SKETCH
>
> New since last run (2026-03-27): binary IPC (Phases 4A-4B), Linda tuple space, fleet daemon (always-on), merge queue, symbol index, orchestrator plugins, encrypted webhook secrets.

---

## S11. IPC Dead-Man Cleanup + Distributed Locks → Crash-Safe Lock Release

**PREMISE A:** The IPC server (`lib/ipc-server.ts`) has a "dead-man cleanup" handler — when any connection drops (crash, killed process, context overflow), the server immediately releases all pub/sub subscriptions that connection held. The cleanup runs in the `socket.on('close')` handler before the connection object is GC'd.

**PREMISE B:** Distributed locks (`lib/locks.ts`) release only via explicit `DELETE /locks/:name` or TTL expiry (default 300s). An agent that crashes mid-task holds its lock for the full TTL before other agents can proceed.

**THEREFORE:** Agents that acquire locks over IPC can register the lock name in the connection's cleanup payload. When the IPC connection drops, the dead-man handler calls `locks.unlock(name, holder)` immediately — no waiting for TTL. A crashed agent releases its locks in microseconds instead of 5 minutes. The IPC server's `connectionMeta` map (already tracking subscriptions per connection) needs one additional field: `heldLocks: string[]`. This is instant, provably safe (if the IPC connection is dead, the agent is dead), and requires zero changes to the HTTP lock API.

**CONFIDENCE:** high

**EFFORT:** small

**SKETCH:** In `lib/ipc-server.ts`, expand the per-connection cleanup handler to call `locks.unlock(name, connId)` for each entry in `conn.heldLocks`. In `lib/ipc-router.ts`, add `LOCK_ACQUIRE` / `LOCK_RELEASE` message types that the router handles by calling `locks.lock()` / `locks.unlock()` and registering the name in `connMeta.heldLocks`. The IPC client (`lib/ipc-client.ts`) gets `acquireLock(name, ttl)` / `releaseLock(name)` methods. HTTP lock API unchanged. Test: crash an agent mid-lock, assert lock is gone immediately (not after TTL).

---

## S12. IPC FIPA Subscriptions + Arbiter Violations → Push-Based Violation Alerts

**PREMISE A:** The IPC server supports `SUBSCRIBE` (0x30) and `UNSUBSCRIBE` (0x31) performatives. When an agent subscribes, the daemon holds the subscription and sends `INFORM` (0x01) fire-and-forget messages as events occur. Dead-man cleanup removes subscriptions when the agent disconnects.

**PREMISE B:** The Arbiter (`lib/arbiter.ts`) records violations in SQLite and returns them only via `GET /arbiter/violations` — agents must poll. Enforcement is reactive but notification is pull-based. The Arbiter already calls `violations.record()` synchronously at the point of detection.

**THEREFORE:** After `violations.record()`, the Arbiter can call into the IPC server's broadcast method to push an `INFORM` frame to any connected agent whose IPC agent ID matches the `agentId` field of the violation. The violating agent receives an `INFORM { type: 'arbiter_violation', rule: 'SESSION_NOTES_INTEGRITY', severity: 'ALERT' }` within milliseconds. The enforcer no longer depends on the violator checking in. An agent can subscribe at startup: `ipc.subscribe({ topic: 'arbiter:violations', filter: { agentId: myId } })` and treat violations as interrupts. This makes HALT-level invariants genuinely halt-capable — the agent gets the message before its next heartbeat.

**CONFIDENCE:** high

**EFFORT:** small

**SKETCH:** Wire `ipcServer.notify(agentId, frame)` into `arbiter.ts`'s `checkInvariant()` after the `violations.record()` call. The IPC server needs a `sendToAgent(agentId, frame)` method that looks up all connections with `connMeta.agentId === agentId` and writes the frame. The IPC auth layer already stores `agentId` per connection (from peer credentials). No new tables. New IPC message type: `ARBITER_VIOLATION`. Add to `ipc-types.ts`. Total: ~40 LOC.

---

## S13. Linda Tuple Space + IPC Subscriptions → Push-Based `in()` Without Polling

**PREMISE A:** The tuple space (`lib/tuples.ts`) implements Linda's `rd()` (read, non-destructive) and `in()` (take, destructive) operations. Currently all operations are synchronous HTTP calls — an agent must poll `GET /tuples` to know when a tuple matching its pattern appears.

**PREMISE B:** The IPC server supports persistent `SUBSCRIBE` registrations — the daemon holds the pattern and pushes `INFORM` messages when matching events occur. This is already used for pub/sub channel subscriptions (commit `eb959b4`).

**THEREFORE:** An agent can send `SUBSCRIBE { topic: 'tuples', pattern: ['task', *, 'pending'], harbor: 'myapp-fleet', destructive: true }` over IPC. When another agent writes a matching tuple via `out()`, the daemon atomically selects one subscriber (if `destructive: true`) and sends an `INFORM` with the tuple fields — consuming the tuple in the same transaction. This is Linda's blocking `in()` made async-push. Exactly one agent handles each work item. No polling loop. No missed tuples. This is the missing synchronization primitive for fleet agent work queues.

**CONFIDENCE:** high

**EFFORT:** medium

**SKETCH:** In `lib/tuples.ts`, after a successful `out()` write, check `ipcServer.hasSubscribers({ topic: 'tuples', harbor })`. If yes, find the first matching subscriber pattern, send `INFORM` with tuple fields, and if `destructive: true`, delete the tuple in the same SQLite transaction (write + notify + delete = one `BEGIN...COMMIT`). In the IPC router, add `TUPLE_SUBSCRIBE` and `TUPLE_OUT` message types. The `TupleSubscription` map lives on the IPC server alongside the existing `ChannelSubscriptions` map. Fleet agents declare `trigger: tuple:['task', *, 'pending']` in pd-fleet.yml and wake up only when work arrives.

---

## S14. Merge Queue + Symbol Index → Topological Merge Ordering

**PREMISE A:** The merge queue (`lib/merge-queue.ts`) accepts `MergeSubmission` objects containing `claims: FileClaim[]` and delegates ordering to the active orchestrator plugin. The default FIFO orchestrator ignores file relationships. Custom orchestrators receive `MergeSubmission[]` and return a `MergeSequence` with ordered IDs.

**PREMISE B:** The symbol index (`lib/symbol-index.ts`) extracts functions, classes, methods, and their dependencies from TypeScript/Python files. `GET /dependencies` returns the call graph. A symbol that calls another symbol creates a directed edge in the dependency graph.

**THEREFORE:** A `DependencyAwareOrchestrator` plugin — registered at startup and selectable via `PUT /merge/plugins/active` — uses the symbol index to reorder the merge queue topologically: branches touching leaf symbols (nothing depends on them) merge first; branches touching hub symbols (many downstream dependents) merge last, after all their dependencies are settled. This prevents integration failures caused by merging a callee after a caller that expects the callee's new signature. The orchestrator API already supports this; the data already exists. No new primitives needed.

**CONFIDENCE:** high

**EFFORT:** medium

**SKETCH:** Create `routes/orchestrators/dependency-aware.ts` implementing `OrchestratorPlugin`. In `orderQueue(submissions)`, call `POST /symbols/parse` for each submission's claimed files (if not already cached by hash), then `GET /dependencies?symbols=...` to get the dependency graph. Build a DAG of submissions where edge A→B means "A's symbols are dependencies of B's symbols." Return `toposort(dag)`. Register in `lib/orchestrator-plugins.ts`'s built-in registry alongside the default FIFO. Add `PUT /merge/plugins/active { name: "dependency-aware" }` call to the fleet's qa-agent's post-merge hook.

---

## S15. Fleet Daemon + Tuple Space → Single-Delivery Work Queues in YAML

**PREMISE A:** The fleet daemon (`lib/fleet-daemon.ts`) watches pd-fleet.yml for agent configurations, auto-starts runners, and republishes events to identity channels. Agents can currently trigger on `trigger: channel:some-channel` (pub/sub — all subscribers receive every message).

**PREMISE B:** Tuple `in()` is destructive — exactly one agent takes a given tuple. In a harbor-scoped context, multiple fleet agents competing to `in()` a tuple with the same pattern creates a natural work queue: first-taker wins, others see nothing.

**THEREFORE:** pd-fleet.yml can declare `trigger: tuple:['job', 'build', '*', 'queued']` — the fleet runner waits for a matching tuple and processes it, with guaranteed single delivery. No separate work queue system. No Redis. No SQS. The tuple space IS the work queue. Multiple instances of the same fleet agent compete naturally: the first one to call `in()` claims the job. Failed jobs can write `['job', 'build', jobId, 'failed']` back into the tuple space, which a retry-fleet-agent picks up. This is the entire producer/consumer pattern in YAML declarations.

**CONFIDENCE:** high

**EFFORT:** medium

**SKETCH:** In `lib/fleet-engine.ts`, add `trigger_type: 'tuple'` alongside the existing `trigger_type: 'channel'`. When a runner starts with a tuple trigger, it opens a persistent IPC connection and sends `TUPLE_SUBSCRIBE` (from S13 above). On `INFORM` delivery, the runner spawns the agent with `PD_TUPLE_FIELDS=<json>` injected into env vars. Update the pd-fleet.yml schema in `docs/adr/0019-declarative-fleet-yaml.md`. The tuple push mechanism (S13) is the dependency — ship that first. This is then a 50-line addition to the fleet engine.

---

## S16. Encrypted Webhook Secrets + Spawner → Webhook-Triggered Agent Spawning

**PREMISE A:** Webhooks now store delivery secrets encrypted at rest (security commit f91195e). The daemon verifies HMAC-SHA256 signatures on delivery before processing, ensuring payloads are from trusted sources. Webhook events cover the full activity surface: `service.claimed`, `agent.registered`, `session.started`, etc.

**PREMISE B:** The spawner (`lib/spawner.ts`) launches agents (claude-cli, ollama, gemini, aider, custom) with full Port Daddy coordination auto-wired (PD_URL, PD_AGENT_ID, PD_SESSION_ID). A `SpawnSpec` accepts an arbitrary prompt and env vars.

**THEREFORE:** A webhook subscription can carry an optional `spawn_spec` field in its metadata. When a verified delivery arrives matching `event: 'session.abandoned'` (or any event), the daemon spawns an agent from `spawn_spec` with the webhook payload injected as `PD_WEBHOOK_PAYLOAD`. A GitHub PR webhook → spawns a code review agent. A CI failure webhook → spawns an incident responder. A monitoring alert → spawns a diagnostics runner. The HMAC verification ensures only authenticated sources trigger spawning — the daemon won't spawn arbitrary code from unauthenticated webhooks. This is event-driven agent deployment with zero CI/CD infrastructure.

**CONFIDENCE:** high

**EFFORT:** small

**SKETCH:** In `routes/webhooks.ts`, in the delivery handler after HMAC verification passes, check if the webhook record has `metadata.spawn_spec`. If so, call `spawner.spawn({ ...metadata.spawn_spec, env: { PD_WEBHOOK_PAYLOAD: JSON.stringify(payload), PD_WEBHOOK_EVENT: event } })`. Add `spawn_spec?: Partial<SpawnSpec>` to the webhook creation schema. Wire spawner into webhook route deps in `server.ts`. Document in README under "Webhook-triggered spawning." Total: ~30 LOC + schema update.

---

## S17. Pheromone Decay + Merge Queue Priority + Fleet Events → Heat-Weighted Dispatch

**PREMISE A:** The pheromone heat map (`GET /pheromone/files`) aggregates session file claim frequency into per-file signals that decay over time. Files that have been heavily contested recently have high heat; heat decays toward zero as contention subsides.

**PREMISE B:** The merge queue accepts a `priority` field in `MergeSubmission` and the orchestrator plugin can use it when ordering. Higher priority = earlier in the merge sequence.

**PREMISE C:** The fleet daemon publishes events to identity channels on every agent state change. The merge queue emits events on every submission and execution.

**THEREFORE:** A "heat-dampened" orchestrator plugin queries the pheromone heat map for each submission's claimed files before ordering. Cold files (heat < 0.3) get elevated priority — they're safe to merge now. Hot files (heat > 0.7) get deprioritized — let the heat decay while other merges go first. The fleet daemon's event stream triggers a priority re-evaluation on every merge queue mutation. The merge queue never stalls on low-risk work while high-contention work blocks it. This connects three Phase 0 systems (pheromone, merge queue, fleet events) into an adaptive throughput scheduler.

**CONFIDENCE:** medium

**EFFORT:** medium

**SKETCH:** Implement `HeatDampenedOrchestrator` as a second built-in `OrchestratorPlugin`. In `orderQueue(submissions)`, for each submission, compute `avgHeat = mean(pheromone.getFileHeat(claim.path) for claim in submission.claims)`. Sort ascending by `avgHeat` (cold-first). Subscribe to fleet events via pub/sub; on `merge.submitted`, call `reorder()` on the active queue. Register alongside FIFO and dependency-aware orchestrators. Let admins configure the heat thresholds in `/config`.

---

## S18. Correlation Engine + IPC Subscriptions → Live Cross-Agent Timeline Feed

**PREMISE A:** The correlation engine (`lib/correlation.ts`) joins activity log entries with session notes into a unified chronological timeline. It can filter by project namespace, returning all events from agents with `identity_project === 'myapp'` in time order.

**PREMISE B:** The IPC server's `SUBSCRIBE` performative establishes persistent interest. When the daemon detects a matching event, it pushes an `INFORM` to all matching subscribers. Currently used for pub/sub channels and (after S11) arbiter violations.

**THEREFORE:** An agent can subscribe over IPC to `timeline:myapp:*` and receive real-time `INFORM` pushes whenever ANY agent in the `myapp:*` namespace writes a note, logs activity, or transitions a session phase. The correlation engine's `addActivity()` hook calls `ipcServer.notifySubscribers('timeline', { project: 'myapp', event: ... })` after every write. An agent maintaining a mental model of its project always knows what peers are doing — without polling, without reading CLAUDE_NOTES.md, without manual briefing requests. This is the information substrate for autonomous re-planning: an agent that sees a peer's session fail can proactively adjust its own work scope.

**CONFIDENCE:** high

**EFFORT:** medium

**SKETCH:** In `lib/activity.ts` and `lib/sessions.ts`, after every write operation, call `ipcServer?.notifyTopic('timeline', { project: identityProject, event: eventType, payload })`. In the IPC router, add `TIMELINE_SUBSCRIBE { projectPattern: string }` message type. On match, look up all connections subscribed to patterns that match the event's project. Push `INFORM { topic: 'timeline', ... }`. The `ipc-client.ts` SDK gets `subscribeTimeline(pattern, handler)`. This is the last missing piece before briefings become unnecessary — agents maintain live context autonomously.

---

---

## S19. Symbol Index + Pheromone → Hot-Symbol Heat Map for Dynamic Conflict Prediction

**PREMISE A:** The symbol index (`lib/symbol-index.ts`) assigns stable integer `id`s to every function, class, and method across parsed files. SHA-256 file caching means these IDs are stable across re-parses of unchanged files — a symbol's ID is a durable identifier, not an ephemeral parse artifact.

**PREMISE B:** The pheromone engine (`lib/pheromone.ts`) sprays numeric signals onto entities via `(table, entity_id, key)`. It already works at file granularity via `GET /pheromone/files` which aggregates by `session_files` claim frequency. The `table` column is free-form — nothing hardcodes file-only tables.

**THEREFORE:** Pheromone can be sprayed at symbol granularity: `POST /pheromone/spray { table: "symbols", id: "<symbolId>", key: "active_edit", strength: 0.95 }`. This creates a hot-symbol heat map — which specific functions are actively being modified, with exponential time decay. `GET /pheromone/symbols?file=lib/auth.ts` returns per-symbol heat levels for all symbols in a file. The merge queue conflict predictor can weight this: a `handleLogin` function sprayed 60 seconds ago (still ~0.85 strength) is a 4× higher-risk merge target than one last touched last week (decayed to ~0.01). Static AST analysis tells you what *could* conflict structurally; pheromone heat tells you what is *being written right now*. These are orthogonal signals; together they make conflict prediction actionable.

**CONFIDENCE:** high

**EFFORT:** session

**SKETCH:** No schema change — `table='symbols'` is valid as-is. Add `GET /pheromone/symbols` route to `routes/pheromone.ts` joining `pheromone_signals` with the `symbols` table on `entity_id = CAST(symbols.id AS TEXT)`. In `POST /conflicts/predict`, add optional `heatWeighted: true` param that multiplies the static `mergeConflictScore` by `(1 + max(heat_for_symbols_in_A_∩_B))`. Add `pd pheromone spray sym:<symbolId> active_edit 0.9` shorthand to CLI. Fleet agents spray their claimed symbols on every session note write. Total: ~80 LOC.

---

## S20. Tuple Space + Symbol Index → Deadlock-Free Symbol-Level Concurrent Claiming

**PREMISE A:** The symbol index (`lib/symbol-index.ts`) exposes `GET /symbols/file/:path` returning all symbols with their start/end line ranges in a file. File-level advisory claims (session files) prevent two agents from editing the same *file*, but cannot prevent two agents from editing the same *symbol in the same file*.

**PREMISE B:** Tuple `in(pattern)` (`lib/tuples.ts`) is destructive and atomic — exactly one caller wins. If ten agents call `in(['sym-claim', 'lib/auth.ts', 'handleLogin', '*'])` simultaneously, one gets the tuple; nine get nothing. The losing agents know immediately, with no lock, no TTL, no polling.

**THEREFORE:** Symbol-level concurrent editing becomes deadlock-free without any new locking primitive. Protocol: before editing symbol `handleLogin` in `lib/auth.ts`, an agent calls `in(['sym-claim', 'lib/auth.ts', 'handleLogin', '*'])`. If the tuple isn't there, it calls `out(['sym-claim', 'lib/auth.ts', 'handleLogin', myAgentId])` then `in()` again — claiming by write-then-take. When done editing, it writes `out(['sym-claim', 'lib/auth.ts', 'handleLogin', 'released'])`. Other agents who lost the race receive a clear signal to wait and retry. This makes the CLAUDE.md rule "never have 2 agents touch the same file" (currently enforced advisorily) enforceable at function granularity — without adding a single line of locking code to the daemon.

**CONFIDENCE:** high

**EFFORT:** trivial (protocol-level — no daemon code needed)

**SKETCH:** This is entirely a client-side coordination protocol using existing APIs. Document as a SDK recipe: `pd.symbolClaim(file, symbolName)` and `pd.symbolRelease(file, symbolName)` SDK methods that wrap `tuples.in()` / `tuples.out()`. The symbol IDs are fetched via `GET /symbols/file/:path`. Add harbor scoping so worktree agents are automatically isolated. Write as a 2-page ADR: "ADR-0021: Symbol-Level Concurrent Claiming via Tuple Space." No server changes required. Ship the docs and SDK wrappers as one session.

---

## S21. Binary IPC Auth + Harbor Tokens → Per-Connection Capability Namespace

**PREMISE A:** IPC auth (`lib/ipc-auth.ts`) verifies agent identity at connection time via `verifyAgent()`, setting identity state on the `IpcConnection` object that persists for the socket's lifetime. The connection is already stateful: `conn.agentId` is set once on registration and applies to all subsequent frames.

**PREMISE B:** Harbor tokens (`lib/harbor-tokens.ts`) are HMAC-signed JWTs verifiable stateless-ly (no DB lookup). They encode `{ agentId, harborName, capabilities[], iat, exp }`. Current usage: injected as `PD_HARBOR_TOKEN` env var by the spawner when `--harbor` is specified (S6 from 2026-03-27).

**THEREFORE:** An agent can include its harbor token in the initial `REQUEST:agent.register` IPC payload. The router verifies the JWT via `harborTokens.verify()` and writes `conn.harborId` and `conn.capabilities` to the connection object — **once**, for the lifetime of the socket. All subsequent IPC actions (tuple `out()`, lock acquire, session start) implicitly carry harbor scope without any per-frame overhead. This makes harbor membership a property of the *connection*, matching Unix permission semantics (credentials set on `execve`, applied to every `syscall`). It also closes a subtle gap: agents that acquire harbor tokens via `pd spawn --harbor` currently re-present the token on each HTTP request; over IPC, they set it once and never think about it again. Harbor-scoped tuple isolation (S13/S15) becomes zero-overhead.

**CONFIDENCE:** medium

**EFFORT:** small

**SKETCH:** Extend `IpcConnection` in `lib/ipc-server.ts` with `harborId?: string` and `capabilities?: string[]`. In `ipc-auth.ts`'s `verifyAgent()`, check for `payload.harborToken`; if present, call `harborTokens.verify(token)` — on success, set `conn.harborId = decoded.harborName`. In `ipc-router.ts`, pass `conn.harborId` as implicit `harbor` parameter to `tuples.out()`, `tuples.in()`, and `locks.lock()`. Update the IPC client to inject `PD_HARBOR_TOKEN` from env during `agent.register`. Backward-compatible: no harbor token = no scoping = existing behavior.

---

---

## S22. IPC Dead-Man Cleanup + Salvage Queue → Millisecond Salvage Latency

**PREMISE A:** The IPC server (`lib/ipc-server.ts`) has a synchronous dead-man handler on
connection close. Existing usage: release pub/sub subscriptions and (after S11) release held
locks. The handler fires the instant the Unix socket drops — process death, SIGKILL, OOM kill.

**PREMISE B:** The salvage/resurrection system (`lib/resurrection.ts`) marks agents stale after
10 missed heartbeats (~10 min) and dead after 20 min. During this window, the dead agent's
session remains open, its file claims block collaborators, and its inbox accumulates stale state.
The reaper is cron-triggered, not event-driven.

**THEREFORE:** An IPC drop is a stronger death signal than heartbeat absence — the process is
provably gone, not slow. Wiring `ipcServer.on('close', (conn) => resurrection.enqueue(conn.agentId, 'ipc_disconnect'))` collapses salvage latency from 10-20 minutes to milliseconds. The reaper cron becomes a backstop for HTTP-only agents; IPC agents get instant salvage. File claims release, harbor slots open, sibling agents receive inbox briefings — all before the dead agent's next heartbeat would have been expected.

**CONFIDENCE:** high

**EFFORT:** trivial

**SKETCH:** In `lib/ipc-server.ts`'s connection close handler, after subscription cleanup, if
`conn.agentId` is set, call `deps.resurrection?.enqueue(conn.agentId, { reason: 'ipc_disconnect', disconnectedAt: Date.now() })`. Add `resurrection?` to `IpcServerDeps`. The resurrection module's `enqueue()` already handles idempotent insertion. The dead-man and the reaper agree: dead is dead. ~10 new lines.

---

## S23. Merge Queue EventEmitter + Webhook Delivery → Free Merge Lifecycle Webhooks

**PREMISE A:** The merge queue (`lib/merge-queue.ts`) uses Node.js `EventEmitter` for all state
transitions: `submit`, `approve`, `reject`, `execute`, `merged`, `failed`, `reverted`. These emit
full `MergeQueueEntry` payloads with `agentId`, `branch`, `claims`, `failureType`, etc.

**PREMISE B:** The webhook system (`lib/webhooks.ts`) delivers authenticated HMAC-signed HTTP
payloads to subscriber URLs on named events. It already serves `service.claimed`, `agent.registered`,
`session.started` — any string event name is valid. Event discovery lives at `GET /webhooks/events`.

**THEREFORE:** A six-line bridge in `server.ts` delivers merge lifecycle webhooks to external
systems with zero new logic. CI/CD pipelines, GitHub Actions, Slack bots, and external
orchestrators subscribe to `merge.submitted`, `merge.approved`, `merge.failed`, `merge.reverted`
as first-class events. The merge queue was designed with the EventEmitter handoff point
precisely for this bridge — it just hasn't been written yet.

**CONFIDENCE:** high

**EFFORT:** trivial

**SKETCH:** In `server.ts`, after both `mergeQueue` and `webhooks` are initialized:
```typescript
for (const evt of ['submit','approve','reject','execute','merged','failed','reverted']) {
  mergeQueue.on(evt, (entry) => webhooks.deliver(`merge.${evt}`, entry));
}
```
Add `merge.*` to `GET /webhooks/events`. Update `features.manifest.json` with `merge-queue`
entry. Total: ~15 lines across 3 files. No schema changes.

---

## S24. Fleet `maxRespawns` Circuit Breaker + Arbiter → Durable Open-Circuit Records

**PREMISE A:** The fleet engine (`lib/fleet-engine.ts`) has a per-agent circuit breaker:
`maxRespawns` (default 3). When exceeded, the runner logs "circuit breaker open" and stops
respawning. This state is pure in-memory — a daemon restart silently resets it, letting a
pathological agent churn indefinitely across restarts.

**PREMISE B:** The Arbiter (`lib/arbiter.ts`) persists invariant violations in SQLite with
`violation_type`, `details`, and agent identity. `GET /arbiter/violations` makes them visible
to operators. Violations survive daemon restarts and can be queried by identity pattern.

**THEREFORE:** When the circuit breaker opens, inject `arbiter.violation('fleet.circuit_breaker_open', { identity, respawns, maxRespawns })`. On fleet startup/SIGHUP reload, before spawning any agent, query `arbiter.violations({ identity, unacknowledged: true })` — if a circuit-breaker record exists, stay offline until an operator runs `pd arbiter clear <identity>`. Circuit breakers survive restarts. Operators see them in `pd arbiter violations`. The pattern pairs with S3 (IPC protocol abuse → Arbiter) to give the Arbiter a third violation source: fleet misbehavior.

**CONFIDENCE:** high

**EFFORT:** session

**SKETCH:** In `fleet-engine.ts`'s death/respawn guard, call `arbiter.injectViolation({ name: 'fleet.circuit_breaker_open', details: { agentName, identity, respawns } })`. In `FleetRunner.start()`, call `arbiter.violations({ identity })` before first spawn; abort if any open-circuit record. Add `arbiter` to `FleetDaemonDeps` in `lib/fleet-daemon.ts`. Add `pd arbiter clear` CLI command. Unacknowledged violations are filtered by checking `acknowledged_at IS NULL`.

---

## S25. IPC SUBSCRIBE + Semantic Trie → Wildcard Identity Channel Subscriptions

**PREMISE A:** The IPC server (`lib/ipc-server.ts`) supports `SUBSCRIBE` (0x30) for persistent
channel interest. Current implementation: exact channel name match. An agent subscribes to
`"git:committed"` and gets frames when that exact channel receives a message.

**PREMISE B:** The semantic trie (`lib/trie.ts`) implements Adaptive Radix Tree resolution of
`project:stack:context` patterns. `trie.resolve('myapp:fleet:*')` returns all registered
identities matching the prefix in O(k) time, independent of fleet size.

**THEREFORE:** An agent sends `SUBSCRIBE { channel: 'myapp:fleet:*' }` and receives INFORM
frames for messages on *any* channel matching that identity pattern — `myapp:fleet:gardener`,
`myapp:fleet:qa`, etc. — without enumerating agent names. FleetBar (S26) subscribes to
`port-daddy:fleet:*` and receives all fleet events from every agent without knowing how many
agents exist. This is the "ambient awareness channels" from the V4 vision paper, implemented
as a trie lookup on every `messaging.publish()` call. Channel-exact subscriptions are unchanged.

**CONFIDENCE:** medium

**EFFORT:** session

**SKETCH:** In `lib/ipc-server.ts`, extend the subscription registry with a `patterns` map
alongside the existing exact-match map. On `SUBSCRIBE`, if the channel contains `*`, store in
`patterns`. In `lib/messaging.ts`'s `publish()`, after the SQLite write, call
`ipcServer?.notifyPatternSubscribers(channel)` which walks the patterns map and uses
`trie.resolve(pattern)` for matching. Add `SUBSCRIBE_PATTERN` to `lib/ipc-types.ts` as a
distinct IPC action type. The trie already handles the lookup — ~60 lines total.

---

## S26. Fleet YAML `harbor` Field + Harbor Tokens → Declarative Harbor Membership at Birth

**PREMISE A:** Fleet config (`lib/fleet-engine.ts`, `FleetConfig.harbor`) declares a harbor
string for the entire fleet (e.g., `harbor: "{project}:fleet"`). Template-expanded and stored,
but currently unused at spawn time — no `harbors.enter()` is called.

**PREMISE B:** Harbor tokens (`lib/harbor-tokens.ts`) are HMAC-signed JWTs injectable as
`PD_HARBOR_TOKEN` env vars. The IPC router (`lib/ipc-router.ts`) respects them for capability
gating. The spawner already injects `PD_HARBOR_TOKEN` when `--harbor` is specified.

**THEREFORE:** When `FleetRunner` spawns any agent in a fleet with a `harbor` field, the daemon
calls `harbors.enter(expandedHarbor, agentId)` before exec, issues a token, and injects
`PD_HARBOR_TOKEN`. Harbor membership becomes a declarative YAML property, not an imperative
`pd harbor enter` call in the agent prompt. Agents die, respawn, and re-enter harbor
automatically. Combined with S21 (harbor token sets `conn.harborId` at IPC registration time),
fleet agents are harbor-scoped from their first IPC frame — zero per-frame overhead.

**CONFIDENCE:** high

**EFFORT:** session

**SKETCH:** In `fleet-engine.ts`'s `_spawnAgent()`, after template-expanding the harbor field:
`await harbors.enter(expandedHarbor, agentId)`, then
`const token = harborTokens.issue(agentId, expandedHarbor, ['fleet-member'])`, then merge
`{ PD_HARBOR_TOKEN: token }` into the child's env. On death/cleanup, call
`harbors.leave(expandedHarbor, agentId)`. Inject `harbors` and `harborTokens` into
`FleetDaemonDeps`. Total: ~30 lines. Update `pd-fleet.yml` docs in ADR-0019.

---

## S27. Merge Queue Failure Events + Pheromone Agent Spray → Outcome-Based Merge Priority

**PREMISE A:** The merge queue (`lib/merge-queue.ts`) emits `merged` and `failed` via
EventEmitter, each carrying `MergeQueueEntry.agentId`. The default FIFO orchestrator plugin
ignores past outcomes when ordering — every submission starts equal.

**PREMISE B:** The pheromone system (`lib/pheromone.ts`) sprays numeric `key/strength` signals
onto `agents` table rows and decays them at `decayRate` per interval. Recent outcomes weight
more heavily than old ones. `ALLOWED_TABLES` already includes `agents`.

**THEREFORE:** On `merged`, spray `pheromone:merge_success = 0.9` onto the submitting agent.
On `failed`, spray `merge_success = 0.1`. The orchestrator plugin's `order()` reads
`pheromone.sniff('agents', agentId, 'merge_success')` as a secondary sort key — high-success
agents float earlier in the queue. Decay ensures forgiveness (one bad merge doesn't doom an
agent forever). This is a self-optimizing merge queue with no explicit reputation table: the
pheromone IS the reputation ledger. The connection between S6 (file heat → merge priority)
and this one: S6 routes around hot files; S27 routes around unreliable agents.

**CONFIDENCE:** high

**EFFORT:** session

**SKETCH:** In `server.ts` after S23's EventEmitter bridge:
```typescript
mergeQueue.on('merged', (e) => pheromone.spray('agents', e.agentId, 'merge_success', 0.9));
mergeQueue.on('failed',  (e) => pheromone.spray('agents', e.agentId, 'merge_success', 0.1));
```
In the default FIFO orchestrator plugin's `order()`, apply secondary sort by
`pheromone.sniff('agents', agentId, 'merge_success')` after the primary FIFO key. Add
`pheromone` to `OrchestratorPluginDeps`. Zero schema changes.

---

## S28. FleetBar SSE + IPC SUBSCRIBE → Sub-Millisecond Menu Bar Fleet Updates

**PREMISE A:** FleetBar (`apps/FleetBar/`) currently polls HTTP endpoints for fleet status.
Fleet routes (`routes/fleet.ts`) expose `GET /fleet/events` as SSE — better than polling,
but still HTTP overhead, buffered through the OS TCP stack.

**PREMISE B:** The IPC socket lives at `~/.port-daddy/port-daddy.ipc` (migrated from `/tmp/`
in security commit `d466103`). The 7-byte frame protocol is fully documented in
`lib/ipc-types.ts`: `[type:1][conv_id:4][payload_len:2][msgpack payload]`. A Swift
MessagePack parser is ~150 lines. The IPC server already handles persistent subscriptions.

**THEREFORE:** FleetBar connects to the Unix domain socket directly, sends one `SUBSCRIBE`
frame for `port-daddy:fleet:*` (using S25's wildcard trie matching), and receives all fleet
lifecycle events as binary pushes. No poll interval. No HTTP round trip. Menu bar icon state
transitions are synchronous with daemon state. On macOS, this is the difference between a
status bar that feels native (AppKit-speed) and one that feels like a web widget. Fallback to
SSE if the socket is unavailable (older daemon version).

**CONFIDENCE:** medium

**EFFORT:** sprint

**SKETCH:** Add `PortDaddyIPCBridge.swift` to `apps/FleetBar/FleetBar/`. It opens a
`unixDomainSocket` to the IPC path, encodes a SUBSCRIBE frame using `Data` bytes per the
7-byte header spec, decodes incoming INFORM frames via a Swift MessagePack decoder (zero
external deps). Dispatches fleet events to a `@Published var fleetState: FleetStatus`.
Depends on S25 (wildcard subscriptions) for full wildcard routing; falls back to exact
channel subscription `port-daddy:fleet` as an intermediate step.

---

*Generated by Spider — 2026-03-31 (second pass)*
*Source corpus: features.manifest.json, CLAUDE.md, docs/V4-UNIFIED-ROADMAP.md, lib/ headers (all 40 modules), git log (last 20 commits), .spark/ideas/, .spider/connections/ (all prior runs excluded)*
*New modules analyzed: ipc-server.ts, ipc-types.ts, fleet-daemon.ts, fleet-engine.ts, routes/fleet.ts, apps/FleetBar, lib/merge-queue.ts, lib/orchestrator-plugins.ts*
*S22-S28 are distinct from S11-S21 (first pass): S22 is salvage-focused vs S11's lock-focused; S25 adds trie wildcards not present in S13; S27 is agent-outcome pheromone vs S17's file-heat pheromone*

---

## S29. Fleet Daemon Subprocess Monitor + Salvage Queue → Self-Healing Fleet Auto-Resurrection

**PREMISE A:** The fleet daemon (`lib/fleet-daemon.ts`) manages `FleetRunner` subprocesses and tracks their exit codes via the `'exit'` handler on each `ChildProcess`. When a subprocess exits non-zero or on unexpected signal, the daemon logs and optionally respawns up to `maxRespawns`. The agent's Port Daddy registration dies with it.

**PREMISE B:** The salvage queue (`lib/resurrection.ts`) preserves a dead agent's session context — notes, file claims, purpose, phase, identity — and exposes it via `resurrection.pending({ project })`. Any new agent can claim the slot and continue the work.

**THEREFORE:** When a fleet runner detects an unexpected process exit AND a salvage entry exists for that agent, the fleet daemon auto-claims the slot before relaunching: `resurrection.claim(deadAgentId, newAgentId)`. The new subprocess starts with `PD_SALVAGE_SESSION_ID` injected, which triggers the salvage-inbox briefing (S2/Spark). Fleet resurrection is now a first-class daemon behavior — not something operators must notice and manually invoke. A fleet agent that crashes mid-task is relaunched with full context, not a blank prompt. The circuit-breaker (S24/`maxRespawns`) still gates infinite respawn loops.

**CONFIDENCE:** high

**EFFORT:** medium

**SKETCH:** In `fleet-daemon.ts`'s runner `'exit'` handler, after checking `config.autoRevive !== false` and `respawnCount < maxRespawns`: query `resurrection.pending({ project: runner.config.project, identity: runner.config.identity })`. If an entry matches (the just-died agent), call `resurrection.claim(entry.agentId, newRunnerAgentId)`. Inject `PD_SALVAGE_SESSION_ID=<entry.sessionId>` into new subprocess env. If no salvage entry (agent died before registering a session), skip salvage — standard cold restart. Wire `resurrection` into `FleetDaemonDeps` in `server.ts`. ~40 new lines.

---

## S30. IPC Dead-Man Cleanup + Session Phases → Crash-Safe Optimistic Phase Rollback

**PREMISE A:** The IPC server's dead-man cleanup fires synchronously when a socket closes — before the connection object is GC'd. Existing cleanup: release locks (S11), enqueue salvage (S22), prune subscriptions. The `connMeta` object is writable up to the close event.

**PREMISE B:** Sessions track phases — `planning → in_progress → testing → reviewing → completed → abandoned`. Phase transitions are optimistic: an agent calls `PUT /sessions/:id/phase { phase: 'testing' }` when it *starts* testing, not after tests pass. A crashed agent can leave a session stuck in `testing` when nothing was ever tested.

**THEREFORE:** When an agent sends a phase transition over IPC, store `{ sessionId, prevPhase, newPhase }` in `conn.pendingPhaseCommit`. If the socket closes before the agent confirms the transition with a `SESSION_PHASE_CONFIRM`, dead-man cleanup calls `sessions.updatePhase(sessionId, prevPhase)` — rolling back the optimistic commit. A crashed mid-test agent no longer leaves sessions falsely showing `testing`: the phase rewinds to `in_progress`, making the session visible to the salvage queue as genuinely unfinished. This is ~10 LOC in the cleanup handler but closes a real correctness gap.

**CONFIDENCE:** high

**EFFORT:** small

**SKETCH:** Add `SESSION_PHASE_COMMIT { sessionId, fromPhase, toPhase }` and `SESSION_PHASE_CONFIRM { sessionId }` to `lib/ipc-types.ts`. In `ipc-router.ts`: on `PHASE_COMMIT`, call `sessions.updatePhase()` AND store commit in `conn.pendingPhaseCommits`. On `PHASE_CONFIRM`, remove from pending. In `ipc-server.ts` close handler: for each pending commit, call `sessions.updatePhase(sessionId, commit.fromPhase)`. HTTP `PUT /sessions/:id/phase` is unchanged — IPC is an enriched semantic layer on top of it.

---

## S31. Pheromone Decay Tick + Agent Inbox → Anomaly-Threshold Proactive Notifications

**PREMISE A:** The pheromone engine (`lib/pheromone.ts`) runs a `setInterval` decay tick every 60 seconds. Each tick iterates ALL signal rows and multiplies by `decayRate`. It already has every agent's `pheromone:anomaly` value in memory during the loop — it just discards the values after decaying.

**PREMISE B:** The agent inbox (`lib/agent-inbox.ts`) delivers structured typed messages to any registered agent by ID. The salvage briefing (S2/Spark) proves the daemon can send inbox messages to agents on behalf of itself: `from: 'port-daddy:salvage'`.

**THEREFORE:** During each decay tick, check for rising-edge crossings on `pheromone:anomaly > 0.7` (using a `prev_value` column — additive migration). On first crossing, send: `inbox.send(agentId, { type: 'anomaly_warning', content: { signal: 0.82, message: 'Your anomaly score crossed 0.7. Arbiter scrutiny increased. Consider pausing.' }, from: 'port-daddy:pheromone' })`. The agent self-corrects *before* a HALT fires — the nudge layer before the sword. This connects the stigmergic engine to the inbox system in a zero-new-infrastructure way: pheromone engine already iterates all values; inbox already accepts daemon-originated messages.

**CONFIDENCE:** high

**EFFORT:** small

**SKETCH:** Add `prev_value REAL DEFAULT 0` column to the pheromone signals table (additive migration). In the decay tick, after the UPDATE, compare new vs prev for `key='anomaly'`. Rising edge: `WHERE key='anomaly' AND value > 0.7 AND prev_value <= 0.7`. For each hit, look up `agents.get(entity_id)` to find the agent. If active, call `inbox.send()`. Store updated `prev_value` in the same transaction. One additive migration + ~30 LOC. Prevents duplicate alerts: only triggers on the crossing edge, not every tick at sustained high anomaly.

---

## S32. Merge Queue Submissions + Harbors → Permission-Scoped Merge Lanes

**PREMISE A:** The merge queue (`lib/merge-queue.ts`) accepts `MergeSubmission` objects with `agentId`, `sessionId`, and claimed files. All submissions enter a single global queue today. The orchestrator plugin's `decide()` is the only ordering/gating mechanism.

**PREMISE B:** Harbors (`lib/harbors.ts`) are named permission namespaces with member tracking. `harbors.isMember(agentId, harborName)` is a fast O(1) lookup. Harbor tokens (S21/S26) make harbor membership a property of the IPC connection, available at zero cost per frame.

**THEREFORE:** Merge submissions can carry `harborName`. The queue routes them to harbor-scoped sub-queues, each with its own orchestrator plugin configuration. `harbor:core-team` → fast lane (immediate approve). `harbor:external-contributors` → review lane (always hold, notify a core-team member). `harbor:ci-agents` → priority lane (automated merges from CI skip review). Harbor membership IS the trust signal; no separate permission table needed. This is the $I_1^+$ selective enforcement from the Bonded Commons paper — enforcement opt-in for bonded work, starting with merge routing.

**CONFIDENCE:** medium

**EFFORT:** medium

**SKETCH:** Add `harbor_name TEXT` to `merge_queue` table (additive migration). In `submitMerge()`, if `spec.harborName` is set, verify `harbors.isMember(agentId, spec.harborName)` — reject with 403 if false. Store in DB. Orchestrator `decide()` receives `entry.harborName` as context; the StigmergicOrchestrator (S3) or DependencyAware (S14) can return different policies per harbor. Expose `GET /merge/queue?harbor=core-team` filter. ~60 LOC + migration.

---

## S33. Wait Endpoint + Tuple Space → Unified Service-and-Work Readiness Gate

**PREMISE A:** The wait module (`GET /wait/:id`, `POST /wait`) uses SSE to block until named services transition to `ready` status. It's the canonical startup-ordering primitive: dependent services wait for their upstreams.

**PREMISE B:** The tuple space (`lib/tuples.ts`) is the work queue primitive (S15): producers write `out(['job', project, taskId, 'queued'])` when work exists; workers call `in()` to claim it. Currently, waiting for work requires polling `GET /tuples`.

**THEREFORE:** `POST /wait { services: ['myapp:api'], tuples: [['job', 'myapp', '*', 'queued']] }` blocks until ALL named services are ready AND at least one matching tuple exists. A worker fleet agent won't start processing until its backing API is up AND work is actually queued. Without this gate, workers spin up, poll empty queues, time out, and respawn in a loop. The unified gate is declarable in `pd-fleet.yml` as a `wait_for` array:

```yaml
wait_for:
  services: [myapp:api, myapp:db]
  tuples: [['job', 'myapp', '*', 'queued']]
```

Fleet startup orchestration becomes a one-liner in YAML.

**CONFIDENCE:** high

**EFFORT:** small

**SKETCH:** Add `tuples?: TuplePattern[]` to `POST /wait` body schema. In the wait handler, after all services signal ready, register a one-shot tuple SSE subscription (non-destructive `rd()` check). Resolve when a matching tuple exists. Combine via `Promise.all()` with the service readiness signals. The tuple is NOT consumed by wait — the worker claims it explicitly with `in()`. ~30 LOC addition to `routes/services.ts`. Add `wait_for` to fleet YAML schema in ADR-0019.

---

## S34. Briefing Module + Fleet Daemon Pre-Spawn Hook → Just-In-Time Agent Briefings

**PREMISE A:** The briefing module (`lib/briefing.ts`) generates `.portdaddy/BRIEFING.md` files assembling session notes, project registry, activity timeline, and (after S8) symbol blast-radius. It's currently a pull operation: agents call `pd briefing` or `POST /briefing` when they think to.

**PREMISE B:** The fleet daemon (`lib/fleet-daemon.ts`) has a distinct `prepareEnv()` stage before each `subprocess.spawn()` call — it resolves YAML templates, injects `PD_*` env vars, and constructs the agent's startup context.

**THEREFORE:** The fleet daemon calls `generateBriefing({ project, identity, sessionId })` immediately before each spawn and injects `PD_BRIEFING_PATH=<path>` into the subprocess env. Fleet agents start with a briefing generated *right now* — reflecting actual current project state — not a stale one from the last manual `pd briefing` run. A 3am scheduled agent gets fresh context. High-frequency trigger agents always see the most current symbol claims, recent notes, and peer activity. The briefing transitions from "you could read it" to "it's always ready."

**CONFIDENCE:** high

**EFFORT:** small

**SKETCH:** In `FleetRunner.start()`, before the spawn call: `const bp = await briefingModule.generateBriefing({ project, identity, sessionId })`; merge `{ PD_BRIEFING_PATH: bp.path }` into child env. Add `briefingModule` to `FleetDaemonDeps` in `server.ts`. Add `briefing: boolean` (default `true`) and `briefing_scope: 'project' | 'identity'` to `FleetAgent` YAML schema. Use content-hash caching (SHA-256 of briefing markdown) to skip re-writes when nothing changed — prevents disk churn on high-frequency triggers. ~30 LOC total.

---

## S35. Note Encryption + IPC Authenticated Socket → End-to-End Encrypted Note Delivery

**PREMISE A:** Session notes are encrypted at rest using envelope encryption (`lib/note-encryption.ts`): AES-256-GCM per note, per-session key, master-key-wrapped. The daemon decrypts at read time and sends plaintext over HTTP. The plaintext lives in daemon memory and transit simultaneously.

**PREMISE B:** The IPC auth layer (`lib/ipc-auth.ts`) verifies agent identity at connection time and stores `conn.agentId` for the socket's lifetime. The socket lives at `~/.port-daddy/port-daddy.ipc` — accessible only to the current OS user (security commit d466103). An authenticated IPC connection provides stronger identity assurance than an HTTP bearer token.

**THEREFORE:** Notes delivered over IPC (salvage briefings, timeline feeds) can be delivered *still-encrypted* with the session key re-wrapped for the requesting agent. Protocol: daemon re-wraps the note's session key with a short-lived delivery key derived from `HMAC(masterKey, agentId || connId || iat)`, delivers `{ encryptedNote, wrappedSessionKey, deliveryKeyId }` in the IPC INFORM frame. The agent unwraps locally using the same HMAC derivation. Plaintext never crosses any interface boundary — it exists only in the agent's process heap. This is S8 from 2026-03-27 (time-scoped rescue keys) generalized to all IPC note delivery, not just salvage. It completes the ProVerif secrecy model: at-rest + in-transit + at-delivery.

**CONFIDENCE:** medium

**EFFORT:** large

**SKETCH:** Add `encryptedDelivery?: boolean` to the IPC agent registration payload. In `sessions.notes()`, if caller context has `encryptedDelivery=true`, return raw encrypted blobs (skip decryption). Compute `deliveryKey = HMAC-SHA256(masterKey, agentId || connId || Date.now())`. Wrap each note's session key with AES-KeyWrap using `deliveryKey`. Return `{ notes: [{ ciphertext, iv, wrappedKey }], deliveryKeyId }`. IPC client (`lib/ipc-client.ts`) gets `decryptNote(note, deliveryKey)` method. New ProVerif model: `analyses/harbor_card_v5_ipc_delivery.pv`. Ship after S11-S22 are stable — this is the capstone, not the foundation.

---

*Generated by Spider — 2026-03-31 (third pass)*
*S29-S35 appended: fleet auto-resurrection, phase rollback, anomaly inbox, merge lanes, unified wait gate, JIT briefings, encrypted IPC note delivery*
*All distinct from S11-S28: checked against all prior syllogisms before writing*
