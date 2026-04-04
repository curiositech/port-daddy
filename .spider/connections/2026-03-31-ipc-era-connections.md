# Spider Connections — 2026-03-31

> **Run context:** Binary IPC has shipped (v3.8.x), adding ipc-server, ipc-client, ipc-router, ipc-auth, ipc-types. Tuples (Linda-style tuple space) are wired. Symbol index (tree-sitter WASM) is live. Merge queue and orchestrator plugins exist. This run focuses on combinatorial possibilities the IPC era opens up.
>
> **Avoided repeats from 2026-03-27-connections.md:** S1 (Pheromone→Arbiter), S2 (Salvage→Inbox), S3 (Trie→Watch), S4 (Fleet+Changelog→Release Notes), S5 (Heatmap+Locks), S6 (HarborTokens+Spawn)

---

## S1. IPC Disconnect → Zero-Latency Salvage Trigger

```
PREMISE A: The IPC server (lib/ipc-server.ts line 288-329) tracks conn.agentId from
           the agent's first frame and fires socket.on('close', ...) when the
           connection drops — cleaning up subscriptions but doing nothing else.

PREMISE B: The salvage system (lib/resurrection.ts) detects dead agents by polling
           heartbeat timestamps: stale after 10 min, dead after 20 min. The reaper
           is called via POST /salvage/reap.

THEREFORE: An IPC socket close is a zero-latency death signal. When socket.on('close')
           fires for a conn with a known agentId, call resurrection.reap({agentId})
           immediately — no 20-minute wait. Agents die the moment their process exits,
           not when a scheduler notices.

CONFIDENCE: high
EFFORT:     trivial

SKETCH: In ipc-server.ts at line 324 (socket.on('close', ...)), after subscription
        cleanup, check if conn.agentId is set. If yes, call
        deps.resurrection.reap({ targetAgentId: conn.agentId }) — this moves only
        the specific dead agent, not all stale agents. Wire resurrection into the
        IPC server's deps object in server.ts (it's already imported). One new call,
        ~5 lines. The detection window collapses from 20 minutes to ~50ms (TCP FIN
        propagation). Fleet agents that crash mid-task are recoverable in seconds,
        not after the next scheduled reap.
```

---

## S2. Tuples + pd watch → Work-Queue Semantics (Exactly-Once Delivery)

```
PREMISE A: pd watch (lib/watch.ts) subscribes to a pub/sub channel and executes a
           shell script per message. Messages are broadcast — every watcher receives
           every message. No concept of "claimed" or "consumed."

PREMISE B: The tuple space (routes/tuples, SDK: tupleIn/tupleOut/tupleRd) implements
           Linda-style destructive reads: tupleIn consumes the first matching tuple.
           Multiple agents racing on the same template: exactly one wins.

THEREFORE: pd watch --tuple '{"type":"build_task","project":"*"}' distributes work
           items across a fleet pool with exactly-once delivery semantics. The first
           fleet agent to execute wins the tuple; others retry. No coordinator needed.
           This is a built-in work queue the fleet YAML could declare directly.

CONFIDENCE: high
EFFORT:     session

SKETCH: In lib/watch.ts, detect if --channel argument begins with '{' (JSON object
        template). If so, route to a polling loop: call DELETE /tuples with the
        template body, execute --exec on success, sleep backoff on 404 (no matching
        tuple). Add --tuple flag alias. Update pd-fleet.yml schema: agents can declare
        trigger: tuple:{...template...}. Fleet engine resolves to the new watch mode.
        The fleet becomes a self-distributing worker pool with zero extra coordination
        code — just a new flag on an existing command.
```

---

## S3. Symbol Index + session_files Columns → Function-Level File Claims

```
PREMISE A: lib/symbol-index.ts (tree-sitter WASM) parses TypeScript/JavaScript/Python
           and extracts symbols with name, type, start_line, end_line. The
           POST /symbols/parse route accepts a file path and returns its symbol map.

PREMISE B: The session_files table (routes/sessions.ts, POST /sessions/:id/files)
           already has start_line, end_line, symbol columns (per CLAUDE.md) — but
           POST /sessions/:id/files never populates them. All claims are file-level.

THEREFORE: pd session files claim <session> src/auth.ts --symbol handleLogin auto-
           parses src/auth.ts via the symbol index, finds handleLogin's line range,
           and stores {start_line: 45, end_line: 72, symbol: 'handleLogin'} in the
           claim. GET /files/who-owns?path=src/auth.ts now returns per-symbol
           attribution. Two agents can own different functions in the same file
           simultaneously — no false conflicts on shared files.

CONFIDENCE: high
EFFORT:     session

SKETCH: In routes/sessions.ts, POST /sessions/:id/files: if body.symbol is present,
        call deps.symbolIndex.parseFile(body.path) (already wired in server.ts per
        routes/symbols.ts), find the symbol by name, set start_line/end_line in the
        INSERT. In GET /files/who-owns, add a line-range overlap check: a claim
        matches if (a) symbol is null (whole-file claim) OR (b) the queried line falls
        within [start_line, end_line]. The column schema already exists — this is
        purely a route-layer change, ~60 lines total.
```

---

## S4. Pheromone Signals + Orchestrator Plugin → Self-Organizing Merge Priority

```
PREMISE A: Orchestrator plugins (lib/orchestrator-plugins.ts) implement
           orderMerges(entries: MergeQueueEntry[]) => MergeSequence. The default
           FIFO plugin orders by submission time. Custom plugins can implement any
           ordering strategy.

PREMISE B: The pheromone system lets agents spray numeric confidence signals (0-1)
           onto entities with decay. An agent's accumulated 'quality' pheromone over
           completed sessions is a proxy for its merge success history.
           GET /pheromone/files gives per-file heat (contention frequency).

THEREFORE: A pheromone-weighted orchestrator plugin computes a merge score:
           score = agentQualityPheromone(submitter) × (1 - fileHeat(changedFiles))
           Agents with high quality + low-contention files go first. Agents that have
           failed merges accumulate low quality pheromone → their future merges are
           de-prioritized automatically. The merge queue becomes a meritocracy that
           self-calibrates via evaporation — no human-maintained priority rules.

CONFIDENCE: medium
EFFORT:     session

SKETCH: New file: lib/orchestrator-pheromone-plugin.ts. implements OrchestratorPlugin
        interface from lib/orchestrator-plugins.ts. In orderMerges(), for each entry:
        call pheromone.read('agents', entry.agentId, 'quality') and
        pheromone.readFiles(entry.changedFiles) to get heat. Score and sort. After
        POST /merge/execute/:id completes (success or failure), spray quality±0.1 onto
        the submitting agent. Register via PUT /merge/plugins/active. Ship in pd-fleet.yml
        as a recommended plugin for teams that care about merge ordering.
```

---

## S5. Fleet YAML + Harbor Tokens → Signed Capability Manifest

```
PREMISE A: pd-fleet.yml declares fleet agents with name, backend, prompt, trigger,
           schedule, worktree — but zero capability scoping. All fleet agents spawn
           with the same ambient permissions as the operator. Nothing prevents a
           'gardener' agent from touching auth code it has no business touching.

PREMISE B: Harbor tokens (lib/harbor-tokens.ts) are HMAC-signed JWTs that declare
           which harbor an agent belongs to and what capabilities it holds. The
           POST /harbors/:name/enter route issues them. Verification is stateless.

THEREFORE: pd-fleet.yml adds a capabilities: field per agent. At fleet startup,
           fleet-engine.ts creates a harbor per agent, enters it with the declared
           capabilities, and injects PD_HARBOR_TOKEN into the spawned process env.
           The YAML file becomes a signed capability manifest — the CI pipeline can
           verify that no fleet agent has capabilities beyond what is declared.

CONFIDENCE: medium
EFFORT:     sprint

SKETCH: In lib/fleet-engine.ts, after spawning an agent (createSpawner call), call
        harbors.create({ name: `fleet-${agent.name}` }) and harbors.enter(agentId,
        { capabilities: agent.capabilities ?? [] }). The returned token goes into
        PD_HARBOR_TOKEN env var alongside PD_URL/PD_AGENT_ID. Add capabilities?: 
        string[] to the FleetAgent interface. The merge queue can then refuse
        submissions from agents presenting harbor tokens that don't include 
        'merge:submit' in their capabilities. This is the minimal viable
        capability-enforcement loop without touching the full credit system.
```

---

## S6. Harbor Members + IPC sendTo → Harbor-Scoped Multicast at Wire Speed

```
PREMISE A: The IPC server (lib/ipc-server.ts) maintains a Map of agentId → IpcConn
           and exposes sendTo(agentId, frame). Per-connection subscriptions are
           already cleaned up on disconnect. The server can reach any registered
           agent by ID without an HTTP round-trip.

PREMISE B: Harbors (lib/harbors.ts) maintain an agent membership list queryable via
           GET /harbors/:name/members. Harbor members share a coordination context
           and already communicate via the HTTP pub/sub system on named channels.

THEREFORE: A new IPC performative MULTICAST (or reuse INFORM with routing:harbor
           in payload) fans a message to every IPC-connected member of a harbor in a
           single server-side loop. Harbor-scoped IPC multicast at wire speed — no
           broker, no HTTP, no pub/sub overhead. Fleet agents in the same harbor
           coordinate at ~50μs latency instead of the ~2ms HTTP round-trip. This is
           the tight-loop communication primitive the Bonded Commons mesh assumes.

CONFIDENCE: high
EFFORT:     session

SKETCH: In ipc-server.ts, add a multicastToHarbor(harborName, frame) method: call
        harbors.listMembers(harborName) synchronously (sqlite, fast), iterate
        member agentIds, call sendTo(agentId, frame) for each IPC-connected one.
        Add new IPC message type HARBOR_BROADCAST in ipc-types.ts. In ipc-router.ts,
        when an agent sends HARBOR_BROADCAST with {harbor, payload}, call
        multicastToHarbor(harbor, {type: INFORM, payload}). HTTP pub/sub remains
        as fallback for agents that aren't IPC-connected (older SDKs).
```

---

## S7. Note Encryption + Changelog → Two-Layer Audit Trail

```
PREMISE A: lib/note-encryption.ts implements envelope encryption for session notes.
           Encrypted notes are stored in SQLite as opaque blobs; plaintext is only
           recoverable by the key holder. The scheme is already wired into sessions.

PREMISE B: The changelog system (lib/changelog.ts) stores all entries as plaintext
           with identity scoping and session linkage. Entries are always public to
           anyone with db access — no redaction concept exists.

THEREFORE: Changelog entries carry an optional encrypted_detail column (same envelope
           scheme) alongside a mandatory plaintext summary. The public changelog shows
           "Auth middleware refactored — 4 functions changed" while the encrypted
           detail holds the specific function names, security rationale, vulnerability
           context, and diff hashes. Teams can publish changelogs to a public dashboard
           without leaking security-sensitive implementation details.

CONFIDENCE: medium
EFFORT:     trivial

SKETCH: In lib/changelog.ts, ALTER TABLE changelog_entries ADD COLUMN encrypted_detail
        TEXT. In POST /changelog, if request body contains detail and an encryption
        key is configured (config.changelogEncryptionKey), call
        noteEncryption.encrypt(detail) and store the ciphertext. GET /changelog
        returns summary always; encrypted_detail only if the requester presents the
        decryption key header (X-PD-Changelog-Key). The listChangelogTree() export
        renders the summary in public markdown, appends "[details encrypted]" marker.
        ~40 lines of new route code; zero library changes.
```

---

## S8. Tuples + Sugar/begin → Live Working Memory (Replaces Static Briefing Files)

```
PREMISE A: The briefing module (lib/briefing.ts) writes .portdaddy/ files to disk
           at session start — a snapshot that immediately begins going stale. Agents
           read these files to understand project context. The files are not queryable
           or updateable without re-running pd briefing.

PREMISE B: The tuple space (tupleOut/tupleRd/tupleScan) provides a shared working
           memory. tupleScan queries without consuming. Tuples can be scoped to a
           harbor. Tuples are live — they reflect state at the moment of the query.

THEREFORE: POST /sugar/begin deposits a live tuple: tupleOut({type:'session', project,
           agent, purpose, files:[], phase:'planning', started_at}). As the session
           progresses, the agent calls tupleOut to refresh it (same key = replace).
           Any agent doing pd discover --project myapp instead reads tupleScan to see
           all active sessions as live tuples — richer than a stale .portdaddy/ file
           and queryable by purpose/phase/files-claimed. The tuple space IS the
           briefing, always current.

CONFIDENCE: medium
EFFORT:     session

SKETCH: In routes/sugar.ts, POST /sugar/begin handler: after startSession() succeeds,
        call tuples.out({type:'session', project: identity.project, agentId, purpose,
        phase:'planning', sessionId, startedAt: Date.now()}) if a tuple module is
        wired (optional, graceful degradation if not). In POST /sugar/done, call
        tuples.in({type:'session', sessionId}) to consume the tuple on completion.
        The discover endpoint (routes/discover.ts if it exists, else add to
        GET /sessions) can offer ?format=tuples to expose active sessions via the
        tuple scan API. The .portdaddy/ briefing files stay as fallback for
        IPC-unconnected agents.
```

---

*Spider run complete. 8 syllogisms. Highest-leverage quick wins: S1 (trivial, huge UX impact on fleet reliability) and S3 (session, unlocks symbol-level parallelism). Highest architectural payoff: S6 (harbor multicast IPC) and S4 (pheromone-weighted merges).*
