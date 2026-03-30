# Spider Connections — 2026-03-29

> **Spider** is the connection engine for Port Daddy. This file records syllogisms: pairs of *already-shipped* features whose composition implies a new, unbuilt capability.
>
> Format: PREMISE A / PREMISE B / THEREFORE / CONFIDENCE / EFFORT / SKETCH
>
> **Prior runs:** 2026-03-27 (S1–S10). All syllogisms below are NEW — no repeats.

---

## S11. Barnacle Watchdog + Pheromone → Daemon Health as Stigmergic Signal

**PREMISE A:** The Barnacle Rust binary (`dist/core/pd-barnacle`) and its client (`lib/barnacle-client.ts`) implement the Ouroboros Architecture: the daemon watches the Barnacle on port 9875, and the Barnacle watches the daemon. It detects crashes, high latency, and unexpected restarts.

**PREMISE B:** The pheromone system allows any process to spray numeric signals (0–1) onto any entity stored in the `ALLOWED_TABLES` set. Signals decay autonomously on read, giving agents a degraded-confidence reading of stale information.

**THEREFORE:** When the Barnacle detects daemon health degradation — rising response times, OOM pressure, restart loops — it can spray `pheromone:health` onto the daemon's well-known agent ID (e.g., `pd-daemon`). Agents that call `GET /pheromone/agents/pd-daemon` before expensive operations (claim, spawn, session start) can back off, retry with jitter, or gracefully self-terminate rather than hammering a struggling daemon. The pheromone decay rate means the health signal self-heals when the daemon recovers — no explicit reset call required.

**CONFIDENCE:** high

**EFFORT:** small

**SKETCH:** In `barnacle-client.ts`, in the health-check loop, call `POST /pheromone/spray` with `{ table: 'agents', id: 'pd-daemon', key: 'health', strength: <latency-normalized-score> }` on each check cycle. A 200ms response time → strength 1.0; 2000ms → strength 0.1; timeout → strength 0.0. SDK clients that call `pd.begin()` can optionally sniff `GET /pheromone/agents/pd-daemon?key=health` first, with a configurable threshold. No schema changes. No new routes. The Ouroboros watches itself.

---

## S12. Session Phases + Float Plans → Atomic Phase-Settlement Bridge

**PREMISE A:** Sessions support 6 lifecycle phases (`planning / in_progress / testing / reviewing / completed / abandoned`) via `PUT /sessions/:id/phase`, already integrated into the MCP tool set and `lib/sessions.ts`.

**PREMISE B:** The V4 Phase 2 Float Plans require a declared work contract — credits escrowed on start, evaluator assigned during review, credits released/forfeited on completion. The settlement trigger is the open design question (what event fires `pd done`?).

**THEREFORE:** Session phase transitions ARE the Float Plan lifecycle events. No separate "anchor" API is needed for the common case. `planning → in_progress` triggers credit escrow. `in_progress → testing` signals to the fleet's evaluator agent. `testing → reviewing` locks file claims. `reviewing → completed` fires settlement and releases escrow. `* → abandoned` liquidates the bond. The `PUT /sessions/:id/phase` route gains economic semantics with a single middleware hook. Sugar `done()` already calls `endSession()` — it becomes the natural settlement gateway with zero API surface change.

**CONFIDENCE:** high

**EFFORT:** medium

**SKETCH:** Add a `phaseHooks` optional injection into `createSessions(db, { phaseHooks })`. Each hook is `async (sessionId, oldPhase, newPhase, session) => void`. At server startup, if the credit module (Phase 2) is loaded, register hooks for each transition. This is the economic activation switch: before Phase 2, all hooks are no-ops. After Phase 2, they're wired. The route handler in `routes/sessions.ts` calls `sessions.setPhase()` which already fires — we only add the hook dispatch. The session phases become the settlement protocol's state machine without the session module knowing anything about credits.

---

## S13. Inbox + Fleet Trigger → Direct-Message-Triggered Agents

**PREMISE A:** The fleet engine (`lib/fleet-engine.ts`) dispatches agents via two mechanisms: `schedule:` (cron) and `trigger:` (pub/sub channel name). The trigger fires when a message appears on the named channel; message content is injected as `PD_MESSAGE` env vars.

**PREMISE B:** The agent inbox (`lib/agent-inbox.ts`) delivers typed structured messages (with `type`, `contentType`, `from` fields) directly to any registered agent by ID. Registration is the cost of addressability.

**THEREFORE:** Fleet agents can declare `trigger: inbox:<type-filter>` in `pd-fleet.yml`. The fleet engine polls `GET /agents/:name/inbox?type=<type-filter>` (or subscribes to inbox SSE if added) and fires the agent on each matching message, injecting the message's `content`, `from`, and `type` as env vars. A QA agent triggered by `inbox:test-request` can be invoked by any peer agent — including spawned children — with a single `pd inbox send qa-agent test-request '{"target": "src/auth.ts"}'`. DM-triggered agents carry caller identity and can reply to the sender's inbox directly, creating point-to-point request/response patterns without shared broadcast channels.

**CONFIDENCE:** medium

**EFFORT:** medium

**SKETCH:** In `fleet-engine.ts`, detect `trigger: inbox:*` patterns. Add an inbox poller alongside the existing SSE channel subscriber. On message receipt, spawn the fleet agent with `PD_INBOX_FROM`, `PD_INBOX_TYPE`, `PD_INBOX_CONTENT` env vars. Mark the message as read after successful spawn. Add `inbox:<type>` as valid completion for `pd-fleet.yml` trigger field. The inbox module already has `listMessages()` and `markRead()` — no new routes needed. This upgrades the fleet's communication topology from broadcast-only to point-to-point.

---

## S14. DNS Records + Harbor Members → Capability-Aware Service Discovery

**PREMISE A:** The DNS module (`lib/dns.ts`) maps semantic identities to `.local` hostnames in SQLite. Any registered service can be resolved by name. `pd dns resolve myapp:api` returns the hostname and port.

**PREMISE B:** Harbor members (`lib/harbors.ts`) declare capability arrays — what they can do, which channels they monitor. The harbormaster (Port Daddy) maintains the manifest. `GET /harbors/:name/members` returns capability-annotated agent lists.

**THEREFORE:** `pd dns resolve --capability "can:summarize"` can join the DNS records table against harbor member capabilities and return all agents/services that have declared this capability in any harbor they currently occupy. This is FIPA-style AMS (Agent Management Service) discovery using the two SQLite tables Port Daddy already maintains. Phase 1D's `pd discover --skill "typescript"` is implemented by this join, not by the graph (which hasn't shipped yet). Capability discovery works today with existing primitives.

**CONFIDENCE:** high

**EFFORT:** small

**SKETCH:** Add `GET /dns/discover?capability=<cap>` route in `routes/dns.ts`. Handler executes: `SELECT DISTINCT d.hostname, d.port, d.identity FROM dns_records d JOIN harbor_members hm ON hm.agent_id = d.identity JOIN harbors h ON h.name = hm.harbor_name WHERE JSON_EACH(hm.capabilities).value = ?`. Add `discover` as a DNS sub-command in the CLI. Update completions. This is ~30 lines of new code across 3 files and implements a meaningful slice of Phase 1D without needing the graph at all.

---

## S15. Correlation Engine + Fleet Engine → Silence-Based Liveness Detection

**PREMISE A:** The correlation engine (`lib/correlation.ts`) merges activity log entries and session notes into a unified chronological timeline per agent. An agent that is working produces a dense stream of `activity` and `note` events.

**PREMISE B:** The fleet engine manages always-on agents and currently detects liveness via heartbeats — a binary alive/dead signal with a fixed timeout window.

**THEREFORE:** Heartbeats prove "alive"; correlation proves "working." A fleet agent can fail to make progress — stuck in a loop, waiting on an infinite LLM call, blocked by a rate limit — while still sending heartbeats. The fleet engine can compute an expected activity density for each agent based on its declared purpose and trigger frequency, then compare actual correlation timeline density. An agent whose correlation timeline is empty for 3× its expected cycle time gets flagged as "alive but silent" — a distinct state from "dead" that warrants different intervention (a poke on pub/sub, a new inbox message) rather than full resurrection.

**CONFIDENCE:** medium

**EFFORT:** medium

**SKETCH:** Add `fleetSilenceThreshold` config field (default: `3 × agent.schedule interval or 30 min for trigger-based`). In the fleet engine's health-check loop (alongside the existing heartbeat poller), call `correlationEngine.getTimeline({ agentId: agent.registeredId, limit: 5 })` and check if the most recent entry is older than the threshold. If silent: publish to `fleet:silent:<agent-name>` channel (which another fleet agent or the operator can watch with `pd watch`). Don't auto-restart — poking is gentler than killing. Add `SILENT` status to `pd fleet status` output alongside `RUNNING` and `DEAD`.

---

## S16. Arbiter Violations + Activity Subscribe SSE → Real-Time Violation Feed

**PREMISE A:** The Arbiter records invariant violations in a SQLite `violations` table at `GET /arbiter/violations`. The route is poll-only — no streaming. The dashboard must refresh to see new violations.

**PREMISE B:** `GET /activity/subscribe` is a live SSE stream of all activity log entries. Any subscriber — dashboard, webhook, `pd watch`, external CI — receives every event in real-time without polling.

**THEREFORE:** Arbiter violations should be emitted to the activity log as `ActivityType.ARBITER_VIOLATION` entries when they occur, rather than only written to the separate violations table. This gives violations immediate real-time distribution across every existing subscriber: the activity SSE stream, the correlation timeline, briefings, webhooks subscribed to activity events, and any `pd watch` script. The Arbiter gains a real-time broadcast bus for free by emitting to the existing activity log rather than maintaining a siloed violations endpoint. The dashboard's Arbiter panel refreshes live with zero new client-side code.

**CONFIDENCE:** high

**EFFORT:** small

**SKETCH:** In `lib/arbiter.ts`, inject the activity log module into `createArbiter(db, { activityLog })`. In `checkInvariant()`, after writing to the `violations` table, call `activityLog.log(ActivityType.ARBITER_VIOLATION, { details: rule.name, metadata: { level, agentId, ruleId, evidence } })`. Add `ARBITER_VIOLATION = 'arbiter_violation'` to the `ActivityType` enum in `lib/activity.ts`. Add it to the webhook events list so external systems can subscribe. The violations table stays as the authoritative record; the activity log becomes the broadcast bus. ~15 lines of change. The dashboard's existing SSE listener picks up violations with no frontend changes.

---

## S17. Sugar begin/done + Worktree Detection → Branch-Scoped Session Guard

**PREMISE A:** Sugar `begin()` (`lib/sugar.ts`) atomically registers an agent and starts a session, writing context to `.portdaddy/current.json`. Sugar `whoami` reads this file to restore session context across tool calls.

**PREMISE B:** Worktree detection (`lib/worktree.ts`) identifies the current git branch, worktree root, and worktree ID deterministically at any call site. The worktree ID is a hash of the root path — stable and collision-free.

**THEREFORE:** Sugar `begin()` should stamp the detected `worktreeId` and `branch` into `.portdaddy/current.json`. Sugar `whoami` should warn if the `.portdaddy/current.json` was written in a DIFFERENT worktree than the current git context — the human equivalent of a zombie agent. The warning message: "⚠️ Active session from branch `feature/auth` detected. Current branch is `main`. Run `pd done` on the original branch or `pd whoami --force` to adopt the session." This catches the "forgot to `pd done` before switching branches" failure mode and prevents session context from bleeding across worktrees, which is the architectural equivalent of S9's auto-namespacing but enforced at the human layer.

**CONFIDENCE:** high

**EFFORT:** small

**SKETCH:** In `sugar.ts`'s `begin()`: call `getWorktreeInfo()` from `lib/worktree.ts`, write `worktreeId` and `branch` fields into `.portdaddy/current.json`. In `whoami()`: call `getWorktreeInfo()` again, compare `current.worktreeId` to the live result. If mismatch, return `{ warning: '...', mismatch: true }` alongside the session data. In the CLI's `whoami` handler, print the warning in amber before the session table. Add a `--force` flag to adopt the session despite the mismatch (for intentional cross-branch work). Zero schema changes. Zero new routes. The worktree module is already imported in `lib/briefing.ts` so the import pattern is established.

---

*Generated by Spider agent — 2026-03-29*
*Source corpus: features.manifest.json, CLAUDE.md, docs/V4-UNIFIED-ROADMAP.md, lib/ headers (first 20 lines each), git log --oneline -20, .spider/connections/2026-03-27-connections.md*
*Avoided: S1–S10 from prior run (pheromone→arbiter, salvage→inbox, trie→watch, fleet→changelog, heat-map→locks, harbor-tokens→spawner, correlation→briefings, note-encryption→salvage, worktree→trie, spawner→pheromone)*
