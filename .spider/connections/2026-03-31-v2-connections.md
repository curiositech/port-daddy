# Spider Connections — 2026-03-31 (v2, supplemental)

> Earlier today Spider found S11–S18 (IPC+Locks, IPC+Arbiter, IPC+Tuples push-sub, MergeQueue+Symbols, Fleet+Tuples, Webhooks+Spawner, Pheromone+MergeQueue heat dispatch, Correlation+IPC timeline).
>
> This run found three connections the v1 run missed. Numbered S19–S21 to avoid collision.

---

## S19. Tuple TTL Expiry + Pheromone Spray → Abandoned-Work Agent Heatmap

**PREMISE A:** Tuples have a TTL/expiry field (`expiresAt`). The `startCleanup()` interval in `lib/tuples.ts` runs `DELETE FROM tuples WHERE expires_at IS NOT NULL AND expires_at < ?` silently — expired tuples vanish with no attribution. The `written_by` column is discarded in the delete.

**PREMISE B:** The pheromone system (`lib/pheromone.ts`) can spray arbitrary numeric signals onto entities in `ALLOWED_TABLES` including `agents`. No caller currently sprays signals on tuple expiry events.

**THEREFORE:** Before the cleanup DELETE, the sweep queries `SELECT written_by, COUNT(*) FROM tuples WHERE expires_at IS NOT NULL AND expires_at < ? AND written_by IS NOT NULL GROUP BY written_by` and calls `pheromoneManager.spray('agents', writtenBy, 'abandoned_work', 0.4 * count)` per agent. The pheromone heatmap then surfaces which agents habitually emit tuples they never consume — a stigmergic record of incomplete coordination visible without requiring those agents to have formally died and entered the salvage queue. This is the lightweight abandonment detector for ephemeral work, complementing (not replacing) the salvage system.

**CONFIDENCE:** high

**EFFORT:** session

**SKETCH:** Change `createTupleSpace(db)` to `createTupleSpace(db, deps?: { pheromones?: PheromoneManager })`. In `startCleanup()`, before `cleanupStmt.run(now)`, run the GROUP BY query and call `deps.pheromones.spray(...)` for each agent. Inject `pheromoneManager` (already in `server.ts`) into the tuple space factory. Add `GET /pheromone/agents` route to aggregate per-agent signals (currently only `/pheromone/files` exists for the file heatmap). ~35 lines total.

---

## S20. Harbor Token Validation + IPC SUBSCRIBE → First Enforced Capability Check

**PREMISE A:** Harbor tokens (`lib/harbor-tokens.ts`) are HMAC-signed JWTs declaring `{ harbor, agentId, capabilities: string[], channels: string[] }`. The harbor schema in `lib/harbors.ts` limits which pub/sub channels members may access. Currently this is advisory — declared, not enforced. The CLAUDE.md roadmap calls enforcement "deferred to v4."

**PREMISE B:** Binary IPC `SUBSCRIBE` (performative 0x30) registers persistent channel interest on the connection object. Dead-man cleanup removes subscriptions on disconnect. There is currently no capability check in the IPC router's `msg.subscribe` handler — any authenticated process can subscribe to any channel.

**THEREFORE:** When an agent sends a REGISTER frame containing `harborToken`, the IPC router decodes and stores the JWT on the connection state. In the `msg.subscribe` handler, if the connection has a stored harbor token, the router checks the requested channel against the token's `channels` list (glob match). On mismatch, it returns a REFUSE frame (0x21) immediately — before the subscription is registered. This is the first *enforcement* point in Port Daddy (not advisory). An agent in `harbor:payments` with `channels: ['payment.*']` physically cannot subscribe to `git:commit` over IPC. The ProVerif model for harbor v1 already covers this case (capability attenuation via token scope) — no new formal verification needed to ship.

**CONFIDENCE:** medium

**EFFORT:** session

**SKETCH:** Add `harborToken?: JwtPayload` to connection state type in `lib/ipc-server.ts`. In the REGISTER handler (`lib/ipc-router.ts`), if `payload.harborToken` is present, call `harborTokens.verify(token)` and store decoded payload on `conn.state`. In `msg.subscribe` case: if `conn.state.harborToken` exists, call `harbors.getHarbor(token.harbor)` and pattern-match the requested channel against `harbor.channels[]`. On mismatch, return REFUSE. Add `harbors` and `harborTokens` as optional fields to `IpcRouterDeps`. Total: ~55 lines. This is "v4 enforcement" implemented now, at the IPC layer.

---

## S21. Merge Queue EventEmitter + Agent Inbox → Zero-Poll Merge Outcome Notifications

**PREMISE A:** The merge queue module (`lib/merge-queue.ts`) imports `EventEmitter` at the top and uses it internally. Submissions progress through terminal states: `merged`, `failed`, `rejected`, `reverted`. Each `MergeQueueEntry` stores the originating `agentId`. No event is currently emitted on terminal state transitions.

**PREMISE B:** The agent inbox (`lib/agent-inbox.ts`) delivers typed, structured messages directly to any registered agent by ID. The salvage system demonstrates daemon-originated inbox delivery (per Spark's S2 proposal, `.spark/ideas/2026-03-27-from-spider.md`). Agents can poll `GET /agents/:id/inbox`.

**THEREFORE:** The merge queue emits `'merge:terminal'` from the EventEmitter after `updateStatus()` sets a terminal state. In `server.ts`, subscribe to this event and call `agentInbox.send(entry.agentId, { type: 'merge_outcome', content: { submissionId, branch, status, decision, failureReason } })`. The submitting agent receives a push notification with the full outcome — no polling `/merge/queue/:id`, no retry loop, no missed results. An agent that submits a merge and context-switches to other work will find the outcome waiting in its inbox, with the full `MergeDecision` rationale. This closes the agent work loop for merging without any new coordination protocol.

**CONFIDENCE:** high

**EFFORT:** trivial

**SKETCH:** In `lib/merge-queue.ts`, add `this.events.emit('merge:terminal', { entry, finalStatus })` inside `updateStatus()` for terminal state cases. In `server.ts` (or new `lib/merge-queue-inbox.ts`), subscribe: `mergeQueue.events.on('merge:terminal', ({ entry, finalStatus }) => { if (entry.agentId) agentInbox.send(...) })`. The adapter is ~25 lines. Both merge queue and agent inbox are already instantiated in `server.ts` and just need wiring. Unlike S12 (IPC+Arbiter push) which requires a new FIPA message type, this uses the existing inbox HTTP pull path — agents check inbox naturally on their next tick.

---

*Generated by Spider — 2026-03-31 (v2 supplemental run)*
*Checked against .spider/connections/2026-03-31-connections.md (S11–S18) to avoid duplication*
*Novel connections added: S19 (tuple TTL→pheromone), S20 (harbor tokens→IPC enforcement), S21 (merge queue→inbox notifications)*
