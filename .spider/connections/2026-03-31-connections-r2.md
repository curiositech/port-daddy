# Spider Connections — 2026-03-31 (Run 2)

> This run read the first 2026-03-31 file and avoided repeating S11-S18.
> New angles: salvage as push primitive, symbol-level pheromones, orchestrator state via blackboard, harbor-enforced IPC, fleet trigger enrichment.
>
> Previously found today (S11-S18): crash-safe lock release, push Arbiter violations, blocking `in()` over IPC, topological merge ordering, tuple-triggered fleet YAML, webhook-spawned agents, heat-dampened dispatch, live timeline feed.

---

## S19. FIPA INFORM + Salvage Reaper → Push-Native Dead Agent Alerts

**PREMISE A:** The heartbeat reaper (inside `lib/agents.ts`) detects stale agents and calls `resurrection.add(agentId)` to move them into the salvage queue. The reaper fires on a timer and transitions agents `active → stale → dead`. Every step is invisible to other agents unless they poll.

**PREMISE B:** The IPC server (`lib/ipc-server.ts`) supports unsolicited `INFORM` (0x01) frames — fire-and-forget pushes from daemon to any connected agent. The IPC router already has a `sendToAgent(agentId, frame)` method implied by S12 above. Agents can open persistent IPC subscriptions at startup.

**THEREFORE:** When the reaper calls `resurrection.add(deadAgentId)`, the daemon can simultaneously broadcast an `INFORM { action: 'salvage.alert', deadAgentId, deadPurpose, project, stack, staleSince }` to all IPC-connected agents whose registered `identity_project` matches the dead agent's. Agents in the same project receive a push within milliseconds of the reaper firing — no polling, no grace period, no `pd salvage` cron. Fleet agents auto-claiming salvage slots become reactive, not scheduled. The first to respond sends `REQUEST { action: 'salvage.claim', deadAgentId, newAgentId: self }`. This turns the salvage lifecycle from "eventual discovery" into "immediate handoff."

**CONFIDENCE:** high

**EFFORT:** small

**SKETCH:** In `lib/agents.ts`'s reaper path, after `resurrection.add(agentId)`, call `ipcServer?.broadcastToProject(identityProject, encodeFrame(Performative.INFORM, FIRE_AND_FORGET, { action: 'salvage.alert', deadAgentId, ... }))`. Add `broadcastToProject(project, frame)` to the IPC server — filters `connMeta` by `identityProject` prefix and writes to each matching connection. The SDK's `ipc-client.ts` gets `onSalvageAlert(cb)`. Fleet daemon auto-subscribes each runner at spawn time. No schema changes. ~25 LOC in two files.

---

## S20. Symbol Index + Pheromone → Function-Level Contention Heat Map

**PREMISE A:** The symbol index (`lib/symbol-index.ts`) stores every extracted symbol — function, class, method, interface — with its `file_path`, `start_line`, and `end_line` in the `symbols` SQLite table. Cross-referencing with `session_files` (which has `start_line`/`end_line`/`symbol` columns) shows exactly which functions have been claimed by agents.

**PREMISE B:** The pheromone system (`lib/pheromone.ts`) sprays numeric signals (0–1) onto rows in `ALLOWED_TABLES = ['services', 'projects', 'sessions', 'agents', 'locks']`. The evaporation engine decays values every 60s. `GET /pheromone/files` already computes file-level heat from session_files claim frequency.

**THEREFORE:** Adding `'symbols'` to `ALLOWED_TABLES` and spraying from the `claimFile()` path creates a *function-level* heat map. When an agent claims `src/auth.ts:handleLogin` (lines 42–78), the daemon sprays `pheromone:contention = 0.8` onto the `handleLogin` row in `symbols`. The merge queue, orchestrator plugins, and dashboard can query `GET /pheromone/symbols?file=src/auth.ts` to see the hottest functions — not just the hottest files. The symbol-level heat map gives the orchestrator the most precise contention signal in the system, enabling function-scoped merge avoidance rather than blunt file-level backoff.

**CONFIDENCE:** high

**EFFORT:** small

**SKETCH:** In `lib/pheromone.ts`, add `'symbols'` to `ALLOWED_TABLES`. In `lib/sessions.ts`'s `claimFile()`, after recording the file claim, run `SELECT id FROM symbols WHERE file_path=? AND start_line <= ? AND end_line >= ?` to find overlapping symbols. For each hit, call `pheromone.spray('symbols', symbolId, 'contention', 0.8)`. Add `GET /pheromone/symbols` route returning top-N hottest symbols, sortable by file or strength. Wire in `routes/index.ts`. The pheromone evaporation engine already handles the `symbols` table once it's in `ALLOWED_TABLES`. ~30 LOC total.

---

## S21. Orchestrator Plugins + Tuple Space → Stateful Blackboard Orchestrators

**PREMISE A:** The orchestrator plugin interface (`lib/orchestrator-plugins.ts`) is stateless by design: given `MergeSubmission[]`, return `MergeSequence`. Each invocation is independent. An orchestrator can't remember what it decided last time, can't store the sprint goal, can't accumulate failure statistics across batches.

**PREMISE B:** The tuple space (`lib/tuples.ts`) is a harbor-scoped shared blackboard (Linda, 1985). Tuples are durable, pattern-matchable, and `rd()` is non-destructive — the orchestrator can read context without consuming it. Tuples can have TTL for automatic staleness handling.

**THEREFORE:** Orchestrator plugins can read and write the tuple space to maintain planning state across invocations. A sprint-aware orchestrator writes `['sprint:goal', 'reduce API latency', timestamp]` once and reads it on every batch call. A risk-aware orchestrator updates `['risk:hot-files', ['src/auth.ts'], timestamp]` after each merge. An adversarial-injection-aware orchestrator stores `['orchestrator:failure-history', agentId, count]` as tuples and demotes agents with repeated merge failures. Orchestrators evolve from one-shot functions into *learning planners* — without adding any new storage primitive. The tuple space is already their memory.

**CONFIDENCE:** high

**EFFORT:** small

**SKETCH:** Add `tupleSpace?: ReturnType<typeof createTupleSpace>` to `OrchestratorContext` (the object passed to every `sequence()` call). Wire `tupleSpace` from the server's `tuples` module into the orchestrator context in `server.ts` at plugin initialization. The default FIFO orchestrator ignores it. Document the namespace convention: orchestrators scope their tuples to `['orchestrator', pluginId, key, ...]` to avoid collision. Add `scan({ harbor: 'orchestrator' })` example to the plugin authoring guide. ~8 lines of wiring, significant power unlocked.

---

## S22. IPC Auth + Harbor Tokens → Capability-Gated Actions at the Wire

**PREMISE A:** The IPC auth module (`lib/ipc-auth.ts`) performs two-phase authentication: socket peer credentials (`uid/gid/pid`) plus agent ID cross-check against the `agents` table. After auth, the IPC router grants the connection full access to all actions — there's no capability differentiation between agents.

**PREMISE B:** Harbor tokens (`lib/harbor-tokens.ts`) are HMAC-signed JWTs declaring harbor membership and capability scopes (e.g., `['lock:payment', 'session:read']`). They're verified in HTTP middleware but the IPC path has never seen them.

**THEREFORE:** The IPC registration handshake (the first frame a new connection sends to identify itself) can carry an optional `harbor_token` field. If present, the IPC auth module verifies the JWT and attaches `connection.capabilities: string[]` from the decoded claims to the connection object. The IPC router adds a `requiredCapability?: string` to each action descriptor and enforces it before dispatch. `lock.acquire` on `payment:*` paths requires `lock:payment`. `session.begin` in bonded harbors requires `bond:session`. This brings Phase 2 capability enforcement down to the binary protocol layer — zero HTTP overhead, impossible to bypass without a valid signed token.

**CONFIDENCE:** medium

**EFFORT:** medium

**SKETCH:** In `lib/ipc-types.ts`, add optional `harbor_token?: string` to the registration frame payload type. In `lib/ipc-auth.ts`, in `verifyAgent()`, check for `harbor_token` in the initial frame; if present, call `harborTokens.verify(token)` and attach decoded `capabilities` to `IpcConnection`. In `lib/ipc-router.ts`'s action dispatch table (the big `switch` statement), wrap the action executor in a capability check helper: `requiresCapability(conn, 'lock:write') || return FAILURE frame`. Add `harborTokens` to `IpcRouterDeps`. Enforcement is opt-in per action using the existing `actionRequiresRegistration` pattern as a model.

---

## S23. Fleet Daemon + Symbol Index → Pre-Enriched Trigger Payloads

**PREMISE A:** The fleet daemon (`lib/fleet-daemon.ts`) dispatches agents on `trigger: git:committed` events by calling `spawner.spawn(spec)` with trigger message content injected into env vars (`PD_MESSAGE`, `PD_MESSAGE_CONTENT`). Fleet agents (QA, test-gap-hunter, documentarian, simplifier) receive a raw commit event and each independently re-parses changed files to understand what symbols changed.

**PREMISE B:** The symbol index (`lib/symbol-index.ts`) uses SHA-256 file-level caching — `extractSymbols(filePath)` checks the file's hash against `symbol_cache` before parsing. Subsequent calls on unchanged files return instantly from cache. The first call after a commit triggers a tree-sitter WASM parse; every subsequent call that session is free.

**THEREFORE:** When the fleet daemon dispatches a `git:committed` trigger, it pre-invokes the symbol index on the changed file list and injects `PD_CHANGED_SYMBOLS=<json>` into the spawned agent's env. Every fleet agent that wakes for the same commit starts with a structured `{ name, type, file, startLine, endLine }[]` manifest — parsed once, shared across all agents. The `test-gap-hunter` already knows which new public functions lack tests before it reads a single byte of source. The `documentarian` already has the full function signature to document. The `qa` agent already knows which symbols touch security-sensitive code. N agents, 1 parse, N richer contexts.

**CONFIDENCE:** high

**EFFORT:** small

**SKETCH:** In `lib/fleet-daemon.ts`'s `dispatchTrigger()`, after resolving `trigger.changedFiles`, check if `symbolIndex` is available in deps. If yes, call `symbolIndex.extractChangedSymbols(changedFiles)` — or just `extractSymbols()` per file if the changed-set API doesn't exist yet — and `JSON.stringify` the result into `env.PD_CHANGED_SYMBOLS`. Add `symbolIndex?: SymbolIndex` to `FleetDaemonDeps`, wire from `server.ts`. Update the fleet agent prompts in `pd-fleet.yml` to reference `$PD_CHANGED_SYMBOLS`. All 5 `git:committed` fleet agents benefit immediately. ~15 LOC.

---

*Generated by Spider — 2026-03-31 (second run)*
*Read previous file before generating: .spider/connections/2026-03-31-connections.md (S11-S18)*
*Source corpus: features.manifest.json, docs/V4-UNIFIED-ROADMAP.md, lib/ module headers, git log last 20, .spark/ideas/*
