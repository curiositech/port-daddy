# Spider Connections — 2026-03-31 Wave B

> **Spider** continuation. S11–S18 were captured in `2026-03-31-connections.md` (IPC, merge queue,
> tuples, fleet daemon main combinations). This wave covers the gaps: sub-file symbol claims,
> harbor bitmask O(1) filtering, cooperative merge via tuples, symbol-level changelog, and
> encrypted tuple coordination.

---

## S19. Symbol Index + Session File Claims → Function-Level Advisory Locks

**PREMISE A:** The symbol index (`lib/symbol-index.ts`) extracts TypeScript/JS/Python symbols with exact line ranges via tree-sitter WASM. After `POST /symbols/parse`, every function, class, and method is in SQLite with `(file, name, start_line, end_line)`.

**PREMISE B:** The `session_files` table already has `start_line`, `end_line`, and `symbol` columns — noted in CLAUDE.md as "already there but unused." Currently every file claim is whole-file; the columns are initialized to NULL. File claims are advisory, not enforced, but they enable conflict detection via `GET /files/who-owns`.

**THEREFORE:** When an agent calls `POST /sessions/:id/files` with a file path, the daemon can auto-resolve the claimed line range by looking up the symbol the agent intends to modify. `claimFile({ path: 'src/auth.ts', symbol: 'handleLogin' })` populates `start_line = 45, end_line = 78`. Two agents claiming different symbols in the same file no longer conflict — `GET /files/who-owns?path=src/auth.ts&line=50` returns agent A, `?line=130` returns agent B. The symbol index fills the `session_files` columns that were designed for this and never used.

**CONFIDENCE:** high

**EFFORT:** small

**SKETCH:** In `routes/sessions.ts`, extend the file claim body schema to accept `symbol?: string`. If present, query `symbolIndex.findSymbol(file, symbolName)` for `{ start_line, end_line }` and pass them through to `sessions.claimFiles()`. The `who-owns` query in `routes/files.ts` already accepts `line` param — it just needs the SQL predicate `AND (start_line IS NULL OR (:line BETWEEN start_line AND end_line))`. The SDK's `claimFiles()` method accepts this as an optional field. Zero schema changes; the columns already exist. Test: two agents claim different symbols in same file — confirm zero conflict report.

---

## S20. Trie Harbor Bitmasks + Harbor Membership Checks → O(1) Scope Filtering at Scale

**PREMISE A:** The semantic trie (`lib/trie.ts`) defines `TrieEntry.harbors?: bigint` — a 64-bit bitmask for harbor membership. Every trie entry can carry the bitmask of all harbors it belongs to. The field is defined, stored in entries, but the filtering logic is documented as "future: O(1) scope checks" — not yet wired.

**PREMISE B:** Harbor membership (`lib/harbors.ts`) is currently checked via SQL: `SELECT * FROM harbor_members WHERE harbor_name = ? AND agent_id = ?`. At 10 agents this is fine. At 500 agents in a fleet doing rapid harbor-gated operations, every operation incurs a SQL roundtrip plus possible disk read.

**THEREFORE:** Assign each harbor a bit position (harbor index 0–63) stored in the harbors table. When an agent enters a harbor, its trie entry gets `harbors |= (1n << BigInt(harborIndex))`. Harbor-gated operations check `(entry.harbors & harborBit) !== 0n` in-memory — no SQL. `trie.prefix('myapp:*', { harborMask: harborBit })` returns only entries in the harbor. Invalidation is a single bitmask write on enter/leave. This is the full O(1) filtering the trie field was designed for. At fleet scale (500+ agents), this eliminates a SQL hotspot that would otherwise dominate latency profiles.

**CONFIDENCE:** high

**EFFORT:** session

**SKETCH:** Add `harbor_index` column (INTEGER 0–63) to the `harbors` table — assigned sequentially at creation, recycled on deletion. In `harbors.enter()`, after SQL insert, call `semanticIndex.setBit(agentId, harborIndex)` which sets the bit in the trie entry. In `harbors.leave()`, call `semanticIndex.clearBit(agentId, harborIndex)`. Update `SemanticIndex.lookup()` to accept an optional `harborMask?: bigint` filter applied at trie traversal time. Expose `GET /harbors/:name/members?fast=true` that reads from the trie index instead of SQL. Benchmark: `ab -n 10000 -c 100` against the harbor-filtered endpoint before and after.

---

## S21. IPC Peer Credentials + Harbors → Ambient Local Harbor Authority

**PREMISE A:** The IPC auth module (`lib/ipc-auth.ts`) extracts OS-level peer credentials from Unix domain socket connections: UID/GID on macOS/Linux. Any agent connecting over the IPC socket (`/tmp/port-daddy.ipc`, `chmod 0600`) is proven to be the same OS user as the daemon owner. This is a hard OS guarantee — no forgeable tokens.

**PREMISE B:** Harbor tokens (`lib/harbor-tokens.ts`) are HMAC-signed JWTs that agents must possess and present. Joining a harbor requires `POST /harbors/:name/enter`, receiving a JWT, storing it, and presenting it. For local development this is ceremony with no security uplift — the agent is already proven to be you.

**THEREFORE:** A harbor created with `{ localOnly: true }` grants membership to any IPC connection whose peer UID matches `process.getuid()`. No JWT issued. No token to store or rotate. `ipcRouter` injects `conn.peer.uid` into every request context; harbor-gated actions check `harbor.localOnly && peerUid === daemonUid` before checking JWT. The full JWT model remains for `localOnly: false` harbors (cross-machine, multi-user). Single-developer workstations get zero-ceremony coordination for local fleets, while the same infrastructure supports cross-org coordination with full JWT ceremony when needed.

**CONFIDENCE:** medium

**EFFORT:** session

**SKETCH:** Add `local_only BOOLEAN DEFAULT 0` to the `harbors` table. In `createHarbors()` (`lib/harbors.ts`), expose `isLocalOnly(harborName): boolean`. In `ipc-router.ts`, in the harbor membership check path, before calling `harborTokens.verify()`, check `harbors.isLocalOnly(harborName) && conn.peer.uid === process.getuid()` — if true, short-circuit to allowed. Add `--local` flag to `pd harbor create` CLI. Document: "For single-developer setups, `--local` harbors authenticate via OS socket credentials. Use full harbor tokens for team/remote scenarios." This unlocks sub-millisecond harbor-gated operations for the common solo-dev case.

---

## S22. Fleet Daemon + Symbol Index → Symbol-Pattern Fleet Triggers

**PREMISE A:** The fleet daemon (`lib/fleet-daemon.ts`) triggers fleet agents when a message appears on a pub/sub channel (`trigger: git:committed`). It uses `fsWatch` for config file changes and subscribes to channels for triggers. All triggers are channel-exact — "wake up when ANY message arrives on channel X."

**PREMISE B:** The symbol index (`lib/symbol-index.ts`) detects symbol-level changes via SHA-256 file hashing. After `parseFile()`, it knows not just that a file changed, but *which symbols* changed — `handleAuth` was modified, `validateToken` was not. The diff is available in the parse result.

**THEREFORE:** Fleet agents can declare `trigger: symbol:handleAuth:*` or `trigger: symbol:*.authenticate:modified`. When the symbol index detects a symbol change in `parseFile()`, it publishes to a synthetic channel `symbol:${symbolName}:modified` with the change payload. The fleet daemon already subscribes to trigger channels — it needs only to recognize the `symbol:` prefix and treat it as a symbol-pattern trigger. A security audit agent wakes up exclusively when auth symbols change. A performance agent wakes up when hot-path functions change. This eliminates fleet false positives (README commit triggering the test agent) and is the fleet-native equivalent of the graph-centric `pd watch` from S3 (2026-03-27).

**CONFIDENCE:** high

**EFFORT:** session

**SKETCH:** In `lib/symbol-index.ts`, after each `parseFile()` that produces modified symbols, call `messaging.publish('symbol:${sym.name}:modified', { file, symbol: sym.name, oldLines: ..., newLines: ... })` for each changed symbol. In `lib/fleet-engine.ts`, add `trigger_type: 'symbol'` detection: if `trigger` starts with `symbol:`, subscribe to the pattern channel using the semantic trie's `prefix()` for wildcard matching. Update `docs/adr/0019-declarative-fleet-yaml.md` with `trigger: symbol:<name>:<event>` syntax. Wire `messaging` and `symbolIndex` into fleet engine deps in `server.ts`.

---

## S23. Linda Tuples + Orchestrator Plugins → Cooperative Merge Priority Signaling

**PREMISE A:** The orchestrator plugin system (`lib/orchestrator-plugins.ts`) receives `MergeSubmission[]` in `decideMergeOrder()`. The default FIFO plugin orders by submission time. The interface is open — any plugin can implement any ordering logic. Plugins have access to the full `MergeQueueEntry` fields including custom metadata.

**PREMISE B:** The tuple space (`lib/tuples.ts`) is a shared blackboard where agents write structured, queryable data. `rd(pattern)` is non-destructive — reading a priority signal doesn't consume it. Any agent can write `out(['pd:merge-priority', branchName, 9, 'security-critical'])` before submitting a merge.

**THEREFORE:** A `TupleSignaledOrchestrator` plugin calls `tuples.rd(['pd:merge-priority', entry.branch, '*', '*'])` for each queued entry during `decideMergeOrder()`. If a tuple exists, the third field (numeric priority 1–10) overrides the FIFO score. This is cooperative priority negotiation: agents declare their urgency via the tuple blackboard, the orchestrator reads and respects it. No API changes needed. No new tables. An agent writes a priority tuple before or alongside the merge submission — the ordering automatically reflects declared intent. This is a working prototype of Phase 2's "Float Plans" without requiring the credit system.

**CONFIDENCE:** high

**EFFORT:** trivial

**SKETCH:** Create `TupleSignaledOrchestrator` in `lib/orchestrator-plugins.ts`. In `orderQueue(submissions)`, for each submission, call `deps.tuples.rd(['pd:merge-priority', submission.branch, '*', '*'])`. Map the third field (priority) to a sort key. Entries without a priority tuple default to priority 5 (FIFO tie-break by submission time). Register in the built-in orchestrator registry. Switch via `PUT /merge/plugins/active { name: 'tuple-signaled' }`. Add a note to `pd merge submit` docs: "Write a priority tuple before submitting to influence queue order." Total implementation: ~60 LOC.

---

## S24. Symbol Index + Changelog → Symbol-Level History Navigation

**PREMISE A:** The changelog module (`lib/changelog.ts`) stores entries linked to `session_id` and `agent_id`, supports hierarchical tree queries (`listChangelogTree()`), and can filter by session or agent. But entries are linked only to the *agents/sessions*, not to the *code symbols* those sessions touched.

**PREMISE B:** The join path already exists across tables: `changelog_entries.session_id` → `session_files.session_id` (file claims) → `session_files.path` → `symbols.file` → `symbols.name`. No new data collection needed — the symbol-to-session mapping is reconstructable from what's already stored.

**THEREFORE:** `GET /changelog/symbol/:symbolName` returns all changelog entries from sessions that had file claims containing the named symbol. A new agent investigating `processPayment` runs `pd changelog --symbol processPayment` and sees every agent who touched that function, with their session notes, in reverse chronological order. Git blame tells you who changed lines; `pd changelog --symbol` tells you *why they were there and what they were trying to do*. This is the semantic git-blame.

**CONFIDENCE:** high

**EFFORT:** trivial

**SKETCH:** Add `listChangelogBySymbol(symbolName: string, limit?: number)` to `lib/changelog.ts`. The SQL: `SELECT ce.* FROM changelog_entries ce JOIN session_files sf ON ce.session_id = sf.session_id JOIN symbols s ON sf.path = s.file WHERE s.name = :symbolName ORDER BY ce.created_at DESC LIMIT :limit`. Add `GET /changelog/symbol/:symbolName` route to `routes/changelog.ts`. Add `--symbol` flag to `pd changelog` CLI. Update features.manifest.json. The symbol index must have parsed the relevant files — combine with `POST /symbols/parse` at `pd briefing` time (briefing already runs on session start). Total: ~30 LOC + route + CLI flag.

---

## S25. Linda Tuples + Salvage System → Structured Agent "Last Will"

**PREMISE A:** The salvage system (`lib/resurrection.ts`) hands off a dead agent's session notes and file claims to the inheriting agent. Session notes are unstructured text — the inheriting agent must read and interpret them. The context quality depends entirely on how well the dead agent wrote notes.

**PREMISE B:** The tuple space (`lib/tuples.ts`) is persistent, harbor-scoped, and supports TTL. The `in(pattern)` operation is destructive and single-delivery — exactly one agent receives the tuple, preventing double-consumption.

**THEREFORE:** When an agent calls `pd begin`, the sugar module auto-writes a "last will" tuple: `out(['pd:will', agentId, { task: purpose, files: [], progress: 0, nextStep: 'Starting' }], { ttl: 86400 })`. The agent updates this tuple via `out(['pd:will', agentId, ...])` as work progresses (new `out` with same pattern replaces the old). When the salvage system claims a dead agent, `resurrection.claim()` calls `tuples.in(['pd:will', deadAgentId, '*'])` before composing the briefing. If a will exists, it delivers a typed `{ task, progress, nextStep, checkpointData }` to the inheriting agent — not just raw notes but structured machine-readable state. The `in()` semantics ensure exactly one inheritor receives the will.

**CONFIDENCE:** high

**EFFORT:** small

**SKETCH:** In `lib/sugar.ts`'s `begin()` function, after registering the agent, call `deps.tuples?.out(['pd:will', agentId, { task: purpose, files: [], progress: 0, nextStep: 'Starting session' }], { ttl: 86400 })`. In `lib/resurrection.ts`'s `claim()`, after retrieving session context, call `deps.tuples?.in(['pd:will', deadAgentId, '*'])` and merge the result into the returned context under `lastWill`. In `routes/resurrection.ts`, include `lastWill` in the briefing inbox message (S2 from 2026-03-27). The `pd begin` CLI can accept `--will-data <json>` for custom checkpoint data. Dead agents that never called `begin` (legacy) degrade gracefully — no will tuple = fallback to note-mining.

---

## S26. Note Encryption + Tuple Space → Encrypted Coordination in High-Security Harbors

**PREMISE A:** Session notes are encrypted at rest via envelope encryption (`lib/note-encryption.ts`): a per-session AES-GCM key encrypts each note, itself wrapped by a master key. The ProVerif model proves Dolev-Yao secrecy. Notes in `session_notes` are `ciphertext BLOB`, not plaintext.

**PREMISE B:** Tuple content (`lib/tuples.ts`) is stored as `value TEXT` (JSON) — entirely in plaintext. In a local dev context this is fine. In a multi-developer harbor or when tuples carry sensitive coordination data (API keys, secrets, half-completed auth tokens, Float Plan details), plaintext tuple storage is a gap.

**THEREFORE:** A harbor can be created with `{ encrypted: true }`. Tuples written to an encrypted harbor have their `value` field encrypted using the same AES-GCM envelope pattern as notes — per-harbor encryption key, wrapped by the master key. `tuples.out()` encrypts; `tuples.rd()` and `tuples.in()` decrypt. Pattern matching on encrypted tuples works on the unencrypted *schema fields* (position 0, 1, 2 in the array) which are stored as separate `field_0`, `field_1`, `field_2` columns in cleartext for indexing, while only the `value` blob is encrypted. This extends the proven security model to the coordination blackboard without breaking pattern matching.

**CONFIDENCE:** medium

**EFFORT:** sprint

**SKETCH:** Add `encrypted BOOLEAN DEFAULT 0` to the `harbors` table. In `createTupleSpace()`, inject `noteEncryption` optionally. In `out()`, if `harbor.encrypted`, call `noteEncryption.encrypt(JSON.stringify(value))` and store ciphertext. In `rd()`/`in()`, call `noteEncryption.decrypt(row.value_ciphertext)` before returning. The pattern matching predicate operates on the schema columns (`field_0`–`field_N`), which are always plaintext positional values from the tuple array (e.g., `['pd:will', agentId, ...]` → `field_0='pd:will', field_1=agentId`). This requires a schema change but follows the exact pattern already proven for notes. The ProVerif model needs one extension to cover harbor-scoped tuple keys.

---

*Generated by Spider — 2026-03-31 (Wave B)*
*Source corpus: features.manifest.json, CLAUDE.md, docs/V4-UNIFIED-ROADMAP.md, all lib/ module headers, git log (last 20 commits)*
*Avoids: S1–S10 (2026-03-27-connections.md) and S11–S18 (2026-03-31-connections.md)*
*New surface areas covered: sub-file symbol claims, trie harbor bitmasks, ambient IPC authority, symbol-pattern fleet triggers, cooperative tuple-based merge ordering, semantic git blame, last-will handoffs, encrypted tuple harbors*
