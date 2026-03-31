# Spider Connections — 2026-03-31 (Run B)

> **Spider** — second pass for today. S11–S18 already found in 2026-03-31-connections.md.
> This file continues from S19. All syllogisms below are new — no overlap with any prior run.
>
> **Corpus delta from Run A:** Same modules, different angles.
> Focused this pass on: IPC connection state as first-class object, session_files symbol columns,
> barnacle as fleet watchdog, tuple → changelog permanence bridge, harbor as quality gate.

---

## S19. IPC Connection Aliveness + Agent Heartbeats → The Connection IS the Heartbeat

**PREMISE A:** The IPC server (`lib/ipc-server.ts`) maintains a live `Map<socket, ConnectionMeta>`
per connected agent. When a socket closes (crash, kill, context overflow), the `'close'` event fires
immediately — the daemon knows within milliseconds that the agent is gone. The dead-man cleanup
already removes subscriptions and (after S11) locks.

**PREMISE B:** The agent registry (`lib/agents.ts`) considers an agent alive only if it receives
a heartbeat ping within a configurable window (default 10 minutes → stale, 20 minutes → dead).
Agents must periodically call `POST /agents/:id/heartbeat` or the IPC fire-and-forget heartbeat
frame.

**THEREFORE:** For IPC-connected agents, the *connection itself* is a stronger liveness signal
than any periodic heartbeat. A socket that is open is *provably alive*. An agent with an active
IPC connection should never enter the stale state. The daemon should set `lastHeartbeat = now()`
on every IPC frame received from an agent — not just explicit heartbeat frames — making the
heartbeat a by-product of normal IPC traffic. The 10-minute stale window becomes a fallback
for HTTP-only agents only.

**CONFIDENCE:** high

**EFFORT:** trivial

**SKETCH:** In `lib/ipc-router.ts`'s frame dispatch loop (called on every received frame), after
auth verification, call `agents.touch(connMeta.agentId)` — a new lightweight method in
`lib/agents.ts` that updates `lastHeartbeat` without the full heartbeat side effects (no pub/sub
publication, no changelog entry). On IPC `'close'`, call `agents.markDisconnected(agentId)` which
flips `lastHeartbeat` to `epoch` — triggering immediate stale detection on the next reaper cycle.
Remove the periodic heartbeat requirement from `lib/fleet-engine.ts`'s runner template when the
runner is using IPC. Agents stop needing to remember to heartbeat; the protocol makes them
implicitly alive.

---

## S20. Symbol Index + Session File Claims Columns → Automatic Symbol-Aware File Claims

**PREMISE A:** The `session_files` table already has `start_line`, `end_line`, and `symbol` columns
(added in the context-aware salvage sprint). These columns are populated by agents that manually
specify their claimed line ranges and symbol names — most agents leave them null.

**PREMISE B:** The symbol index (`lib/symbol-index.ts`) can call `getSymbolsInRange(file,
startLine, endLine)` to extract the exact named symbols within any line range, using cached
tree-sitter WASM parses (SHA-256 keyed, zero re-parse cost for unchanged files).

**THEREFORE:** When an agent claims a file via `POST /sessions/:id/files`, if `startLine`/`endLine`
are provided but `symbol` is null, the daemon can *automatically* run
`symbolIndex.getSymbolsInRange(file, startLine, endLine)` and populate the `symbol` column with
the comma-delimited result. If neither range nor symbol is provided, the daemon runs a full-file
parse and stores the top-level exported symbol names. File claims become symbol-aware without any
agent coordination overhead — the symbol column is populated as a side effect of the claim itself.

**CONFIDENCE:** high

**EFFORT:** trivial

**SKETCH:** In `routes/sessions.ts`'s file claim handler, after the SQLite insert, check if
`start_line` and `end_line` are present. If yes, call `symbolIndex.getSymbolsInRange(file,
start, end)` and run `UPDATE session_files SET symbol = ? WHERE session_id = ? AND file = ?`.
The `symbolIndex` is already wired in `server.ts`; inject it into the sessions route deps.
`GET /files/who-owns?path=src/auth.ts` starts returning symbol-level ownership automatically.
No agent code changes needed — the daemon enriches what agents provide.

---

## S21. Orchestrator Plugins + Harbor Membership → Harbor as Merge Queue Capability Gate

**PREMISE A:** The orchestrator plugin registry (`lib/orchestrator-plugins.ts`) receives
`MergeSubmission` objects with `agentId`, `sessionId`, `claims`, and `metadata`. The `REFUSE`
decision type allows the orchestrator to reject a submission outright, with an optional reason.

**PREMISE B:** Harbor membership (`lib/harbors.ts`) is queryable: `harbors.getMembers(name)`
returns all currently-entered agents. A harbor can represent a quality tier — e.g., `trusted-merge`
— that agents must join before their work is eligible for the merge queue.

**THEREFORE:** A `HarborGatedOrchestrator` plugin rejects any `MergeSubmission` from an agent
not currently in the `trusted-merge` harbor. Admission to the harbor is controlled by a
human operator or an evaluator agent that reviews work quality. The merge queue becomes
capability-gated: only agents that have been vouched for can merge. This is the simplest possible
reputation system — no credits, no scoring, just "in the harbor or not" — and it works with
existing infrastructure.

**CONFIDENCE:** high

**EFFORT:** trivial

**SKETCH:** Implement `HarborGatedOrchestrator` in `routes/orchestrators/harbor-gated.ts` (a
second built-in plugin alongside FIFO and dependency-aware). In `approveSubmission(sub)`, call
`harbors.getMembers('trusted-merge')`. If `sub.agentId` is not in the member list, return
`{ decision: 'reject', reason: 'Agent not in trusted-merge harbor' }`. The harbor name is
configurable in the plugin's `config` field at registration. Human operators or senior evaluator
agents act as harbor bouncers. Register as third built-in. Add to `GET /merge/plugins` response.
~30 LOC.

---

## S22. Tuple Space (TTL) + Changelog → Ephemeral Work → Permanent Record Bridge

**PREMISE A:** Tuples have a configurable `expiresAt` TTL — ephemeral coordination data that
auto-cleans from the store. A completed work token (e.g., `['job', 'build-auth', 'done',
agentId, result_hash]`) naturally expires after all consumers have read it.

**PREMISE B:** The changelog (`lib/changelog.ts`) accumulates hierarchical, identity-scoped
entries with `session_id` and `agent_id` attribution — permanent, immutable audit trail.

**THEREFORE:** The daemon should write a changelog entry every time a tuple with `type: 'work'`
(or any agent-declared significance flag) is consumed via `in()`. The tuple fields become the
changelog content: `{ entry: 'Tuple consumed: job=build-auth result=SUCCESS agent=agent-123' }`.
Ephemeral coordination leaves permanent evidence. The "Merkle-chained evidence trail" described in
the V4 Phase 2 settlement spec can be built from tuple consumption records — each `in()` becomes
an attribution event. Pro-rata credit release requires exactly this audit trail.

**CONFIDENCE:** medium

**EFFORT:** small

**SKETCH:** In `lib/tuples.ts`'s `in()` implementation (destructive take), after the DELETE, check
if the tuple had a `type: 'work'` field in `fields[0]` (or a `log: true` metadata field set at
`out()` time). If yes, call `changelog.add({ identity: writtenBy, agentId: consumedBy, content:
JSON.stringify({ tuple: fields, consumedAt: Date.now() }), type: 'tuple_consumed' })`. The
`changelog` factory is already injected into most route deps; add it to tuple deps. Add
`log: boolean` to the `TupleWriteOptions` interface for agents to opt specific tuples into the
permanent record. Phase 2 settlement query: `GET /changelog/agent/:id?type=tuple_consumed`
returns the full evidence trail.

---

## S23. IPC Peer Credentials + Note Encryption → Session Key Delivery Over Trusted Channel

**PREMISE A:** IPC auth (`lib/ipc-auth.ts`) extracts the peer UID from the Unix socket at
connection time. The socket is `chmod 0600` (owner-only) — any connected peer is provably the
same OS user as the daemon. This is a stronger trust anchor than any token.

**PREMISE B:** Note encryption (`lib/note-encryption.ts`) uses envelope encryption: a master key
wraps a per-session AES-GCM key, which encrypts each note. To decrypt notes, an agent needs the
per-session key. Currently the session key is transmitted in API responses over HTTP — potentially
logged, captured in proxies, or visible in `~/.port-daddy/*.log`.

**THEREFORE:** For IPC-connected agents (same user, same machine), the daemon can deliver
per-session encryption keys as binary IPC frames — never touching the HTTP log path. The agent
sends `REQUEST { action: 'session.getKey', sessionId }` over the 0600 socket. The daemon
responds with `INFORM_REF { key: <bytes> }`. The key never appears in HTTP access logs, never
crosses a network, and is delivered to a process whose UID the OS vouches for. This is
"cryptographic locality" — using physical co-location as a trust primitive.

**CONFIDENCE:** medium

**EFFORT:** medium

**SKETCH:** Add `IpcAction.SESSION_GET_KEY` to `lib/ipc-types.ts`. In `lib/ipc-router.ts`'s
handler, verify the requesting agent has an active session on `sessionId`, then call
`noteEncryption.exportSessionKey(sessionId)` and return the raw bytes in an `INFORM_REF` frame.
In `lib/note-encryption.ts`, add `exportSessionKey(sessionId): Buffer` — extracts and returns
the per-session key in plaintext (only callable via IPC router, not via HTTP). HTTP key delivery
remains for backward compat but is deprecated for local agents. Update `lib/sessions.ts`'s
`decryptNote()` to prefer IPC-delivered key if available in the client's key cache.

---

## S24. Barnacle Watchdog + Fleet Daemon → The Fleet as an Ouroboros Subsystem

**PREMISE A:** The Ouroboros architecture (`lib/barnacle-client.ts`) has daemon → monitors →
Barnacle (port 9875) and Barnacle → monitors → daemon. If either crashes, the other survives and
can restart it (via launchd). This is a two-node mutual resurrection ring.

**PREMISE B:** The fleet daemon (`lib/fleet-daemon.ts`) runs *inside* the daemon process. If
the daemon crashes, the fleet dies too — all fleet runners lose their supervisor. Fleet runners
become orphan processes with no heartbeat manager and no restart logic.

**THEREFORE:** Barnacle should monitor fleet runner process IDs directly. When the daemon dies,
Barnacle inherits the fleet's process table (a snapshot sent periodically as `POST
:9875/fleet-snapshot` from fleet-daemon). Barnacle doesn't restart runners (it's not a process
supervisor) but it sends SIGTERM to orphaned runners when the daemon is confirmed dead, preventing
zombie fleet agents from continuing to write to shared state (sessions, notes, file claims) with
no supervisor. The fleet Ouroboros extends to three nodes: Barnacle → daemon → fleet → Barnacle.

**CONFIDENCE:** medium

**EFFORT:** sprint

**SKETCH:** In `lib/fleet-daemon.ts`, add `broadcastSnapshot()` that calls `barnacleClient.
pushFleetSnapshot({ runners: activeRunners.map(r => ({ pid: r.pid, agentId: r.agentId, identity:
r.spec.identity })) })`. Call this every 30s and on every runner state change. In Barnacle's Rust
handler, add `POST /fleet-snapshot` that stores the runner PID list. In Barnacle's daemon-death
handler (already exists for self-restart logic), iterate stored PIDs and send SIGTERM. Add
`GET :9875/fleet-status` for `pd doctor` to query post-crash. This prevents the "ghost agent"
failure mode: agents writing notes to dead sessions after their supervisor is gone.

---

## S25. Semantic Trie + Tuples → Pattern-Addressed Tuple Space

**PREMISE A:** The semantic trie (`lib/trie.ts`) supports O(k) wildcard prefix lookups over
`project:stack:context` identity strings. `trie.match('myapp:auth:*')` returns all registered
tokens under that prefix from an in-memory index.

**PREMISE B:** Tuples are currently addressed by value pattern matching (`*`, exact, `>N`, `<N`).
There is no concept of tuple *routing by identity* — a tuple written by `myapp:auth:agent-1` is
indistinguishable in the query interface from one written by `billing:tax:agent-9`.

**THEREFORE:** Tuple `scan()` and `in()` can accept an *identity prefix* as a scoping parameter,
resolved via the semantic trie. `in(['task', *, 'pending'], { identity: 'myapp:auth:*' })` matches
only tuples written by agents whose registered identity matches `myapp:auth:*`. This creates a
*semantic address space* for the tuple space — tuples are findable not just by content pattern but
by the identity of who wrote them. Fleet agents in a project's auth subsystem coordinate on
auth-namespace tuples without any naming convention enforcement.

**CONFIDENCE:** high

**EFFORT:** session

**SKETCH:** In `lib/tuples.ts`'s `scan()` and `in()` methods, add an optional `identityPattern?:
string` parameter. When present, resolve matching agent IDs via `semanticIndex.match(pattern)`,
then add `WHERE written_by IN (...)` to the SQLite query. The trie's in-memory index provides the
agent ID set. The `written_by` column already exists in the `tuples` table. Wire `semanticIndex`
into `createTuples(db, semanticIndex?)` factory. Add `--identity` flag to `pd tuple in` and
`pd tuple scan` CLI completions. This makes tuple patterns composable with the existing identity
namespace model, unifying two independent addressing systems.

---

## S26. IPC Router + Session Sugar (`begin`/`done`) → Atomic Agent Bootstrap Over IPC

**PREMISE A:** The sugar module (`lib/sugar.ts`) implements `begin()` and `done()` as compound
operations: `begin()` atomically registers an agent, starts a session, and writes to
`.portdaddy/current.json`. This is a 3-step HTTP round-trip today.

**PREMISE B:** The IPC router (`lib/ipc-router.ts`) handles `REQUEST` performatives that need
responses, using conversation IDs for correlation. The router already dispatches to sugar's deps
(agents, sessions) via the same service layer HTTP uses.

**THEREFORE:** `begin()` can be a single IPC `REQUEST { action: 'sugar.begin', ... }` →
`INFORM_DONE { agentId, sessionId, port }` round-trip, completing in a single socket write +
read rather than three HTTP requests. For fleet agents that bootstrap thousands of sessions per
day, this reduces agent startup overhead by ~65% (3 × TCP round-trip vs. 1 × IPC frame). The
`.portdaddy/current.json` write still happens, but the network path is the IPC socket rather
than the loopback TCP stack. This is the "IPC sugar" path: same semantics, lower overhead.

**CONFIDENCE:** high

**EFFORT:** small

**SKETCH:** Add `IpcAction.SUGAR_BEGIN` and `IpcAction.SUGAR_DONE` to `lib/ipc-types.ts`. In
`lib/ipc-router.ts`, add handlers that call `sugar.begin(spec)` and `sugar.done(spec)` from the
existing `lib/sugar.ts` module. The sugar module is already injected into `server.ts`'s dep tree.
Update `lib/ipc-client.ts` to expose `begin(spec)` and `done(spec)` as SDK methods — the client
sends `REQUEST { action: 'sugar.begin' }` and awaits `INFORM_DONE` with timeout. The `PortDaddy`
SDK class's existing `begin()`/`done()` methods can transparently prefer IPC when a socket
connection is available. HTTP path unchanged for backward compat.

---

*Generated by Spider — 2026-03-31 (Run B)*
*Avoided: S1–S18 from prior runs (see 2026-03-27-connections.md and 2026-03-31-connections.md)*
*New combinations this run: IPC connection-as-heartbeat, symbol-autofill for file claims,
harbor-as-merge-gate, tuple→changelog bridge, IPC key delivery, fleet-as-Ouroboros-subsystem,
trie-addressed tuples, IPC sugar bootstrap.*
