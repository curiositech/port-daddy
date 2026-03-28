# Spider Connections — 2026-03-27

> **Spider** is the connection engine for Port Daddy. This file records syllogisms: pairs of *already-shipped* features whose composition implies a new, unbuilt capability.
>
> Format: PREMISE A / PREMISE B / THEREFORE / CONFIDENCE / EFFORT / SKETCH

---

## S1. Pheromone Signals → Adaptive Arbiter Thresholds

**PREMISE A:** The Arbiter (`lib/arbiter.ts`) checks every state transition against six hard-coded invariant rules with fixed enforcement levels (LOG / ALERT / HALT).

**PREMISE B:** The pheromone system (`lib/pheromone.ts`) lets agents spray numeric confidence signals (0–1) onto any entity (services, agents, sessions, locks) with read-time decay.

**THEREFORE:** The Arbiter's invariant thresholds can be made adaptive: when `pheromone:anomaly` on an agent exceeds a configurable watermark, the Arbiter drops its intervention threshold for that agent — more aggressive scrutiny, lower evidence bar for HALT. High-anomaly agents get tighter oversight automatically, without any human rule change.

**CONFIDENCE:** high

**EFFORT:** medium

**SKETCH:** Add a `readPheromone(table, id, key)` hook inside `checkInvariant()` in `arbiter.ts`. Before evaluating a rule, query the pheromone store for `anomaly` on the triggering agent or session. If the signal exceeds `config.adaptiveThreshold` (default 0.7), override the rule's enforcement level to the next tier. Wire the pheromone manager into the Arbiter's deps object at server startup. No schema changes needed. This is Appendix A1 (Bayesian Arbiter) implemented with existing primitives.

---

## S2. Salvage Queue → Inbox Briefing Delivery

**PREMISE A:** The salvage system (`lib/resurrection.ts`) captures a dead agent's full session context — session ID, notes, file claims, purpose, identity — when a new agent claims the resurrection slot.

**PREMISE B:** The agent inbox (`lib/agent-inbox.ts`) delivers typed, structured messages directly to any registered agent by ID; the sender can specify `contentType` and `type`.

**THEREFORE:** When an agent claims a resurrection slot (`POST /salvage/claim/:agentId`), the daemon should compose a structured "salvage briefing" inbox message and deliver it to the claiming agent's inbox automatically. The agent wakes up to find its inbox pre-loaded with the dead agent's last N notes, file claims, and session phase — no manual briefing file read required.

**CONFIDENCE:** high

**EFFORT:** small

**SKETCH:** In `routes/resurrection.ts`, after the `salvageClaim()` call succeeds, call `sessions.sessionDetails(deadSession.id)` and `sessions.notes(deadSession.id, { limit: 20 })`, package into a `{ type: 'salvage_briefing', contentType: 'application/json', content: { ... } }` object, then call `inbox.send(claimingAgentId, message)`. The inbox already exists and is wired. Total new code: ~25 lines in the route handler.

---

## S3. Semantic Trie → Graph-Centric `pd watch`

**PREMISE A:** The semantic trie (`lib/trie.ts`, `lib/semantic-index.ts`) supports O(k) wildcard prefix lookups — `myapp:auth:*` resolves all tokens under that prefix from an in-memory index updated on every register/claim/release.

**PREMISE B:** `pd watch` (`lib/watch.ts`) subscribes to a named pub/sub channel and executes a shell script for each message, with reconnect loop and env var injection.

**THEREFORE:** `pd watch` can accept a *trie pattern* instead of a channel name. The daemon emits a synthetic event whenever the semantic index changes for any identity matching the pattern. This is Appendix A8 (Graph-Centric pd watch) implemented with the trie that already shipped in commit `5338951`.

**CONFIDENCE:** high

**EFFORT:** medium

**SKETCH:** Add a `GET /index/subscribe?pattern=myapp:auth:*` SSE route in a new `routes/index.ts`. On every `SemanticIndex.update()` call (register/claim/release), check if the changed identity matches any active SSE subscriber's pattern using `trie.match()`. If yes, push the event. Modify `lib/watch.ts` to detect if the `--channel` argument starts with a known identity segment (contains `:` or `*`) and route to the new SSE endpoint instead. Update features.manifest.json and add `--pattern` flag to watch completions.

---

## S4. Fleet Engine + Changelog → Machine-Generated Release Notes

**PREMISE A:** The fleet engine (`lib/fleet-engine.ts`) supports `trigger:`-based agents that fire when a message appears on a named pub/sub channel, passing message content as env vars to the spawned agent.

**PREMISE B:** The changelog module (`lib/changelog.ts`) accumulates hierarchical, identity-scoped entries linked to sessions and agents, exportable as markdown via `listChangelogTree()`.

**THEREFORE:** A `release-scribe` fleet agent triggered by `git:tag` or `pd:session:fleet:done` can automatically pull all changelog entries since the last tag, render them as markdown, and commit `CHANGELOG.md` — fully machine-generated, human-reviewed. No cron needed; it's event-driven.

**CONFIDENCE:** medium

**EFFORT:** small

**SKETCH:** Add one entry to `pd-fleet.yml`: `release-scribe` with `trigger: fleet:session:done` and a Claude-CLI backend. The agent's prompt: "Call `pd changelog --json --since <last_tag>`, render as grouped markdown grouped by identity prefix, output to CHANGELOG.md." The fleet already has Claude-CLI spawning working. The changelog already has `GET /changelog?since=...` filtering. This is a YAML declaration, not new code — except possibly a `--since` query param on `/changelog` if not already present.

---

## S5. File Heat Map + Locks → Hot-File Priority Routing

**PREMISE A:** The pheromone file heat map (`GET /pheromone/files`) aggregates session file claim frequency into a per-file signal, identifying which files are most frequently contested across sessions.

**PREMISE B:** The locks module (`lib/locks.ts`) grants locks first-come-first-served with configurable TTL, but has no awareness of which locks are on high-contention files.

**THEREFORE:** Lock acquisition on files with heat above a threshold could fast-path to the agent that already holds the most file claims in that directory (the "local expert"), while queueing other agents. This prevents hot files from thrashing between agents with no context, and is the advisory enforcement foothold described as $I_1^+$ in the Bonded Commons paper — without requiring the full credit system.

**CONFIDENCE:** medium

**EFFORT:** medium

**SKETCH:** In `routes/locks.ts`, on `POST /locks/:name` where the lock name looks like a file path (contains `/`), query `/pheromone/files?path=<name>&depth=0`. If heat exceeds `config.hotFileThreshold` (default 0.6), check `GET /files/who-owns?path=<name>` for the current session holder. If there's an existing holder and the requester is not them, return 409 with `Retry-After` header (advisory backoff). No schema changes; uses two existing endpoints as data sources.

---

## S6. Harbor Tokens + Spawner → Capability-Gated Agent Spawning

**PREMISE A:** Harbor Tokens (`lib/harbor-tokens.ts`) are HMAC-signed JWTs declaring which harbor an agent belongs to and what capabilities it holds. Verification is stateless at the daemon.

**PREMISE B:** The spawner (`lib/spawner.ts`) launches agents with auto-wired Port Daddy coordination (register/session/heartbeat/done) by injecting `PD_URL`, `PD_AGENT_ID`, and `PD_SESSION_ID` as environment variables.

**THEREFORE:** `pd spawn --harbor <harbor-name>` can issue a harbor card at spawn time and inject it as `PD_HARBOR_TOKEN` into the child agent's environment. The child agent starts inside the harbor's capability namespace from its first operation, inheriting the parent's permissions without re-authenticating. This is Appendix A9 (Harbor Resource Inheritance) for the spawn use case.

**CONFIDENCE:** high

**EFFORT:** small

**SKETCH:** In `SpawnSpec` (top of `spawner.ts`), add `harborName?: string`. In `createSpawner().spawn()`, if `spec.harborName` is set, call `harbors.enter(spec.harborName, agentId)` then `harborTokens.issue(agentId, spec.harborName, ['spawn-inherited'])` and inject the resulting JWT into `env.PD_HARBOR_TOKEN`. The child can then call `pd harbor members` or use the token for downstream harbor operations. Add `--harbor` flag to `pd spawn` CLI and completions.

---

## S7. Activity Log + Correlation Engine → Enriched Briefings

**PREMISE A:** The correlation engine (`lib/correlation.ts`) joins activity log entries with session notes into a unified chronological timeline, filterable by agent ID or session ID.

**PREMISE B:** The briefing module (`lib/briefing.ts`) generates `.portdaddy/` files for new agents to read on startup, currently pulling from project registry and session state.

**THEREFORE:** Briefings can include a "Recent Cross-Agent Timeline" section: the last 20 events across all agents in the same project, rendered as a markdown timeline. A new agent arrives knowing not just the session notes but *what happened in the project* across all concurrent agents — who claimed what, who published what, which locks were contested.

**CONFIDENCE:** high

**EFFORT:** small

**SKETCH:** In `briefing.ts`'s `generateBriefing()` function, after assembling the session notes section, call `correlationEngine.getTimeline({ limit: 20, agentId: undefined })` (project-scoped). Render the results as a `## Recent Activity` section in the briefing markdown. Inject `correlationEngine` into `createBriefing(db, correlationEngine)` deps. The correlation engine is already instantiated in `server.ts`. This is ~30 lines of new code and improves every `pd briefing` invocation immediately.

---

## S8. Note Encryption + Salvage → Time-Scoped Decryption Tokens

**PREMISE A:** Session notes are encrypted at rest using envelope encryption (`lib/note-encryption.ts`): master key wraps a per-session key, which encrypts each note. The ProVerif model proves Dolev-Yao secrecy.

**PREMISE B:** The salvage system (`lib/resurrection.ts`) hands off a dead agent's session context to a new agent, including access to all session notes.

**THEREFORE:** Rather than granting the salvaging agent permanent access to the dead session's decryption key, the daemon can issue a time-limited "rescue key" — a session key wrapped with a TTL-bearing token, valid only while the salvage claim is active. The key dies when the salvage is marked complete or abandoned. Work in progress is protected; stale reconstructions cannot decrypt old notes.

**CONFIDENCE:** medium

**EFFORT:** large

**SKETCH:** Add a `rescue_keys` SQLite table: `(jti TEXT PK, session_id TEXT, wrapped_key BLOB, expires_at INTEGER)`. In `salvageClaim()`, derive a rescue token by re-wrapping the dead session's note key with a new AES-GCM key held only in daemon memory (not persisted), recording just the wrapped form. Return the rescue token in the salvage claim response. Add `decryptNoteWithRescue(noteId, rescueToken)` to the sessions API. Revoke rescue tokens in `salvageComplete()` and `salvageAbandon()`. This extends the ProVerif threat model and is worth a new `.pv` model before shipping.

---

## S9. Worktree Detection + Semantic Trie → Auto-Namespaced Worktree Identities

**PREMISE A:** Worktree detection (`lib/worktree.ts`) identifies the current git worktree — branch name, worktree ID (hash of root path), and whether it's the main worktree — at every daemon startup.

**PREMISE B:** The semantic trie (`lib/trie.ts`) indexes identities with colon-segment namespacing, supporting `project:stack:context` with wildcard prefix resolution.

**THEREFORE:** When `pd claim myapp:api` is called from a linked worktree (branch `feature/auth`), the daemon can automatically resolve it to `myapp:api:feature-auth` — making worktree context part of the semantic identity without any manual flag. Agents on different branches cannot accidentally collide on ports. `pd list myapp:api:*` shows all worktree variants.

**CONFIDENCE:** high

**EFFORT:** medium

**SKETCH:** In `services.ts`'s `claim()` function, detect if the `context` segment is absent and if the calling environment has `WORKTREE_ID` or `GIT_BRANCH` set (injected by the orchestrator or sugar module). If so, auto-append the sanitized branch name as the context segment. The trie already handles the resulting `project:stack:context` identity perfectly. Add `--no-worktree-scope` flag to opt out. Update briefing generation to group services by worktree context. This resolves the "two agents touch the same file" problem (CLAUDE.md rule #3) architecturally.

---

## S10. Spawner + Pheromone → Reputation-Proxied Backend Selection

**PREMISE A:** The spawner (`lib/spawner.ts`) selects agent backends (ollama/claude/gemini/aider/custom) by explicit `--backend` flag, with no awareness of past performance.

**PREMISE B:** The pheromone system allows agents to spray numeric signals onto any entity. Evaluator agents or test runners can spray `pheromone:quality` onto completed agent identities after reviewing their output.

**THEREFORE:** `pd spawn` can use accumulated `pheromone:quality` signals on agent identity patterns to auto-select the best-performing backend for a given task domain. An agent identity of `myapp:test-writer` that consistently receives high quality signals gets preferred; one that repeatedly gets low scores gets demoted to a cheaper/faster backend. This is a working prototype of the Phase 2 reputation system using Phase 0 and Phase 3 infrastructure that already ships.

**CONFIDENCE:** medium

**EFFORT:** medium

**SKETCH:** Add `--auto-backend` flag to `pd spawn`. When set, `createSpawner().spawn()` queries `GET /pheromone/agents/:identityPattern?key=quality` for the most recent N agent IDs matching the requested identity pattern, averages their signals, and maps the average to a backend tier: `>0.8 → claude-opus`, `0.5–0.8 → claude-haiku`, `<0.5 → ollama`. Store the routing decision in the spawn record for later attribution. The fleet YAML can declare `backend: auto` to opt entire fleets into reputation-based routing. This makes pheromone signals economically meaningful before the full credit system lands in Phase 2.

---

*Generated by Spider agent — 2026-03-27*
*Source corpus: features.manifest.json, CLAUDE.md, docs/V4-UNIFIED-ROADMAP.md, lib/ headers, git log (last 20 commits)*
