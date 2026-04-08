---
name: port-daddy
description: "Multi-agent coordination daemon for AI coding agents (v3.8.3). Eliminates port conflicts, tracks sessions, recovers crashed agents, runs background fleets, provides binary IPC for high-frequency communication, pheromone trails for ambient signaling, tuple spaces for shared memory, and declarative fleet orchestration. Use when starting a coding session, coordinating parallel agents, claiming ports for dev servers, leaving notes for other agents, spawning background workers, running declarative agent fleets, or debugging multi-agent failures. Works with Claude Code, Gemini CLI, Cursor, Windsurf, Codex, and any backend Port Daddy can spawn."
---

# Port Daddy v3.8.3 — Agent Coordination That Actually Works

## The Problem You Have Right Now

You're an AI agent. You're about to start a dev server. Which port? 3000? Taken. 3001? Another agent grabbed it. You pick a random port. Now nothing can find your server.

Meanwhile, another agent is editing the same file you are. Neither of you knows. You'll both commit. One of you loses work.

A third agent crashed 20 minutes ago — halfway through a migration. Its work is orphaned. Nobody knows.

**Port Daddy solves all of this in one daemon.**

## Quick Start (Do This First)

```bash
# 1. Start your session — ALWAYS do this first
pd begin "Building auth module"

# 2. Claim a port — deterministic, never conflicts
PORT=$(pd claim myapp:api:main -q)

# 3. Leave breadcrumbs for other agents
pd note "JWT validation working, moving to refresh tokens"

# 4. Check who else is working here
pd salvage --project myapp    # Any dead agents to rescue?

# 5. End cleanly
pd done
```

## Why This Matters

Without Port Daddy:
- Port conflicts every time two agents run dev servers
- No record of what agents did or decided
- Crashed agents leave orphaned work nobody finds
- No way for agents to signal each other
- File edit collisions destroy work silently

With Port Daddy:
- Deterministic ports — same identity always gets the same port
- Immutable notes — full audit trail of every decision
- Salvage queue — dead agent work is preserved and claimable
- Pub/sub + file claims — agents coordinate without stepping on each other
- Background fleet — QA, docs, testing run automatically on every commit
- Binary IPC — sub-microsecond heartbeats and pheromone sprays over Unix socket
- Pheromone trails — ambient numeric signals that decay over time for contention detection
- Tuple space — shared typed memory for swarm coordination
- Semantic trie — O(k) identity lookups replacing SQL LIKE scans

## MCP Tools Available

**Start here (high-level, one call does many things):**

| Tool | What It Does |
|------|-------------|
| `begin_session` | Register as an agent + start a session atomically |
| `end_session_full` | End session + unregister atomically |
| `whoami` | What agent am I? What session? What files do I own? |
| `catch_me_up` | What happened while I was away? Recent activity, notes, dead agents |
| `swarm_awareness` | Who else is working here? All agents, sessions, file claims |
| `file_heat` | Which files are agents fighting over? Pheromone-based contention map |
| `talk_to_agent` | Send a direct message to a specific fleet agent by name |
| `claim_port` | Get a deterministic port for a service identity |
| `add_note` | Leave an immutable breadcrumb (notes can never be deleted) |
| `acquire_lock` | Distributed lock for critical sections |
| `spawn_agent` | Launch a background AI agent with a task |
| `fleet_init` | Set up a background agent fleet with git hooks and pd-fleet.yml |
| `pd_discover` | Find additional tools by category |

**Tuple space tools (shared swarm memory):**

| Tool | What It Does |
|------|-------------|
| `tuple_out` | Write a typed tuple to the shared space (harbor-scoped) |
| `tuple_read` | Read tuples matching a pattern (non-destructive) |
| `tuple_take` | Atomically read + remove tuples matching a pattern |
| `tuple_scan` | List all tuples in a harbor or global space |
| `tuple_count` | Count tuples matching a pattern |

**Discover more tools by category:**
Call `pd_discover` with a category name: `magic`, `session-lifecycle`, `ports`, `sessions`, `notes`, `locks`, `messaging`, `agents`, `inbox`, `webhooks`, `integration`, `dns`, `briefing`, `tunnels`, `projects`, `changelog`, `activity`, `system`, `tuples`, `pheromone`

**Integration signals:** Use `integration ready` and `integration needs` to coordinate service dependencies. When your service is ready, signal it so other agents can proceed.

## Core Concepts

### Semantic Identities: `project:stack:context`

Every service gets a semantic name. The name IS the port — deterministic hashing means the same identity always maps to the same port. Identities are indexed in an in-memory **Adaptive Radix Tree** for O(k) lookups (where k is key length), replacing SQL LIKE scans.

```bash
pd claim myapp:api:main           # Always gets port 3142 (or whatever hash gives)
pd claim myapp:api:feature-auth   # Different port, same project
pd find 'myapp:*'                 # Prefix search — resolves through the trie, not SQL
pd find 'myapp:*:main'            # Wildcard — all stacks with context "main"
```

### Sessions & Notes

Sessions track what each agent is doing. Notes are **immutable** — once written, they can never be edited or deleted. This creates an audit trail that agents and humans can trust. Notes are **encrypted at rest** with AES-256-GCM (master key at `~/.port-daddy/master.key`, auto-generated on first boot).

```bash
pd begin --identity myapp:api --purpose "Building auth"
pd note "Found SQL injection in token validation"
pd note "Patched. Tests green."
pd done
```

### Salvage (Dead Agent Recovery)

When an agent crashes, its session enters the salvage queue. Another agent can claim and continue the work:

```bash
pd salvage --project myapp        # See dead agents' context
pd salvage claim dead-agent-42    # Pick up their work
```

**IMPORTANT:** Always check `pd salvage` at the start of a session. You might be able to continue where a crashed agent left off instead of starting from scratch.

### File Claims (Advisory)

```bash
pd session files claim src/auth/*.ts
# Another agent tries the same file:
pd session files claim src/auth/login.ts
# → CONFLICT: claimed by agent 'myapp:api'
```

Claims are advisory — they warn, don't lock. Hard locks cause deadlocks. Advisory claims cause conversations.

### Pub/Sub Messaging

Agents signal each other through channels:

```bash
# Agent A finishes database setup
pd pub myapp:events "database-ready"

# Agent B was watching
pd watch myapp:events --exec "npm run migrate"
```

### Distributed Locks

For operations that truly must be exclusive:

```bash
pd with-lock deployment -- npm run deploy
# Or manually:
pd lock db-migration --ttl 300
pd unlock db-migration
```

## Binary IPC Protocol (v3.8.3)

High-frequency agent communication over a Unix domain socket with MessagePack encoding. The IPC channel sits alongside the HTTP API — agents that need low-latency communication (heartbeats, pheromone sprays, pub/sub publish) use IPC automatically when the daemon is running.

**Key properties:**
- **7-byte header**: `[type:1][conv_id:4][payload_len:2]` + MessagePack payload
- **70-80% bandwidth reduction** vs HTTP JSON
- **~3us latency** for fire-and-forget operations (vs ~200us HTTP)
- **13 FIPA performatives**: INFORM, REQUEST, QUERY_REF, REFUSE, FAILURE, NOT_UNDERSTOOD, SUBSCRIBE, UNSUBSCRIBE, etc.
- **Fire-and-forget**: heartbeats, pheromone sprays, pub/sub publish (conv_id=0)
- **Request-response**: claims, locks, sessions (conv_id for correlation)
- **Pub/sub subscriptions**: with dead-man cleanup on disconnect
- **Auto-reconnect**: client reconnects with subscription replay on socket drop
- **SDK fast paths**: `heartbeat()`, `pheromoneSpray()`, `publish()` auto-use IPC when available

**Socket location:** `~/.port-daddy/daemon.ipc`

**Security hardening:**
- Rate limiting: 500 frames/sec per connection
- Connection limit: 256 max (REFUSE for excess)
- 3-strike protocol violation budget (malformed frames disconnect)
- Backpressure via write queue + drain events
- Lock release on IPC disconnect

You don't need to use IPC directly. The SDK and CLI use it transparently for hot-path operations.

## Fleet: Background Agents (v3.8.3)

Declare agents in YAML. They fire on git commits, cron schedules, or pub/sub messages. Auto-respawn on crash with circuit breaker. **As of v3.8.3, fleets run inside the daemon process** — they start automatically on daemon boot and survive terminal close.

**Two modes:**

```bash
# CLI mode — manual, terminal-attached
pd fleet init     # Creates pd-fleet.yml + git hook
pd fleet up       # Starts the fleet (runs until Ctrl+C or pd fleet down)
pd fleet validate # Parses YAML, resolves templates, and checks trigger topology
pd fleet status   # What is the fleet doing?
pd fleet down     # Stop the fleet

# Daemon mode — always-on (automatic)
# Place pd-fleet.yml in a registered project root.
# The daemon auto-discovers it on boot and starts the fleet.
PD_URL="${PORT_DADDY_URL:-http://localhost:9876}"  # Use pd status if yours differs
curl "$PD_URL/fleet"              # Global status across all projects
curl "$PD_URL/fleet/my-project"   # Per-project status
curl -XPOST "$PD_URL/fleet/reload"  # Reload after editing pd-fleet.yml
curl "$PD_URL/fleet/events"       # SSE lifecycle stream
```

The starter fleet includes: **QA** (bug hunting), **Documentarian** (docs sync), **Cartographer** (roadmap tracking), **Spark** (idea generation), **Spider** (cross-feature connections).

`pd fleet status` now surfaces backend readiness and sandbox-sensitive local execution hints so users can see install/auth/permission blockers before a fleet run fails.

## `pd agent`: One-Shot Autopilot Delegation

For bounded single-agent work, `pd agent "task text"` now auto-wraps:

- session begin
- spawned execution
- session close

It also prints the resolved runtime up front and can honor explicit runtime flags:

```bash
pd agent "review the last commit for risks"
pd agent "summarize git status" --backend custom
pd agent "investigate auth flow" --backend gemini --tier mid
```

This is the lightest-weight delegation surface. It is for one-shot work, not always-on automation.

## `pd sortie`: Tracked Mission Delegation

`pd sortie` is now a first-class mission surface, not just a plan-doc idea.

Already shipped:

- durable sortie ids
- persisted mission records
- explicit sortie harbors (`project:sortie:<id>`)
- sortie status lookup
- sortie event logs

Current truthful limitation:

- the first shipped slice still runs one coordinating spawned agent underneath
- richer multi-agent approvals, artifact/result pages, and human-in-the-loop controls are still the next layer from `docs/recovery/PD-AGENT-SORTIE-PLAN.md`

Examples:

```bash
pd sortie "Investigate flaky auth tests and summarize the root cause" \
  --backend codex \
  --tier low \
  --budget 0.75

pd sortie list
pd sortie status sortie-abc123
pd sortie logs sortie-abc123
```

Use the delegation surfaces this way:

- `pd spawn` — low-level primitive
- `pd agent` — preferred one-shot single-agent sugar
- `pd sortie` — tracked mission record with harbor + logs + outcome lookup
- `pd fleet` — always-on project automation

Canonical explanation: `docs/DELEGATION-MODES.md`

```yaml
# pd-fleet.yml
fleet:
  name: myapp
  harbor: "{project}:fleet"

  limits:
    max_concurrent_spawns: 2        # Max parallel agent runs
    max_spawns_per_hour: 20         # Hourly rate cap (rate limiting)
    budget_usd_per_day: 5           # Daily LLM spend ceiling in USD

  agents:
    qa:
      trigger: git:committed        # React to pub/sub events
      respawn: true                 # Auto-restart on crash
      max_respawns: 3               # Circuit breaker
      backend: ollama
      model: qwen2.5-coder:7b
      prompt: "Review the last commit for bugs..."

    test-hunter:
      trigger: git:committed
      backend: codex
      model: gpt-5.4-mini
      prompt: "Expand test coverage around risky changes..."

    gardener:
      schedule: "*/10 * * * *"      # Or run on a cron schedule
      backend: custom
      prompt: "git status --porcelain"
      on_success: publish git:status  # Chain agents via channels

  channels:
    git:committed:
      description: "Fired after a successful commit"
      consumers: [qa]
```

**Key features:**
- Works with any LLM backend: `ollama`, `codex`, `claude-cli`, `claude`, `gemini`, `aider`, `custom`
- Prefer local-first tiers for always-on fleets: cheap Ollama loops for broad coverage, Codex for higher-signal code work, Claude CLI only when its tool surface is specifically needed
- Template variables (`{project}`) resolve from the YAML context
- `on_success: publish <channel>` chains agents via pub/sub (DAG topology validated at startup)
- Fleet harbor auto-created on start — all agents share a semantic namespace
- Each agent gets full PD coordination: registration, sessions, heartbeats, salvage on crash
- Auto-respawn with `respawn: true` and `max_respawns` circuit breaker
- **Daemon mode**: fleet auto-discovered from registered projects on daemon boot; editing `pd-fleet.yml` triggers hot-reload; SIGHUP reloads all fleets
- **Project fleet leases**: daemon-owned fleets are singleton per project across daemons; another daemon may discover the same `pd-fleet.yml`, but it must skip starting that project if a lease is already held
- **Resource limits**: `limits.max_concurrent_spawns` and `limits.max_spawns_per_hour` prevent runaway agents
- Lifecycle events published to `fleet:events` channel for dashboard/menu bar subscriptions

Keep the distinction clear:
- `singleton: true` on an agent prevents overlapping runs of that one agent inside a single fleet runner
- project fleet leases prevent two different daemons from both running the same project fleet at once

## Tuple Space: Shared Swarm Memory (v3.8.3)

Agents write typed tuples to a shared space. Other agents query by pattern. Based on Linda (Gelernter, 1985). Harbor-scoped for fleet isolation. TTL for auto-expiry.

```bash
# Spider writes a connection it discovered
pd tuple out '["connection", "trie+pubsub=routing", "spider", 0.9]' --harbor myapp:fleet

# Spark reads all connections with confidence > 0.7
pd tuple rd '["connection", "*", "*", ">0.7"]' --harbor myapp:fleet

# Take (remove) a processed task from the space
pd tuple in '["task", "build-auth", "pending"]'

# Scan all tuples in a harbor
pd tuple scan --harbor myapp:fleet

# Count tuples
pd tuple count --harbor myapp:fleet
```

Pattern matching: exact values, `*` wildcard, `>N`/`<N` numeric comparisons, `myapp:*` semantic identity prefixes.

**HTTP API:**
- `POST /tuples` — write a tuple (body: `{ tuple, harbor?, writtenBy?, ttl? }`)
- `GET /tuples` — read by pattern (query: `pattern`, `harbor`, `limit`)
- `DELETE /tuples` — take (destructive read) by pattern
- `GET /tuples/scan` — list all tuples in a harbor
- `GET /tuples/count` — count tuples

## Pheromone Trails: Ambient Signals (v3.8.3)

Agents spray numeric signals (0-1) onto entities. Signals decay exponentially over time at read, creating ambient awareness without polling.

```bash
# Spray a signal onto a service
pd pheromone spray --table services --id myapp:api --key urgency --strength 0.8

# Sniff pheromone values (applies read-time decay)
pd pheromone sniff --table services --id myapp:api

# View file heat map (which files are most contested)
pd pheromone files

# List all non-zero pheromone trails
pd pheromone list
```

Use cases: file contention detection, agent reputation scoring, hot-path identification, adaptive thresholds.

**HTTP API:**
- `POST /pheromone/spray` — set a pheromone value (body: `{ table, id, key, strength }`)
- `GET /pheromone/:table/:id` — read pheromone values (applies read-time decay)
- `GET /pheromone` — list all non-zero pheromones
- `GET /pheromone/files` — file heat map from session file claims (query: `path`, `depth`)

## The Arbiter: Runtime Invariant Enforcement (v3.8.3)

The Arbiter monitors every state transition against 6 formally-derived invariants from the TLA+ specification:

- **PID squatting** — no process can claim another's port
- **Capability escalation** — agents can't exceed declared capabilities
- **Note monotonicity** — notes are append-only, never deleted
- **Escrow positivity** — encrypted note escrow balances stay positive
- **Lock owner validity** — only the owner can release a lock
- **Heartbeat freshness** — stale agents get reaped

In strict mode, critical violations trigger man-overboard salvage.

```bash
pd arbiter status         # Check rules and violation count
pd arbiter violations     # List recorded violations
```

## Runtime File Locations (v3.8.3)

All runtime files live in `~/.port-daddy/` (not `/tmp/`). This eliminates symlink attacks, survives `/tmp/` cleanup, and keeps permissions user-private (0700 directory).

| File | Purpose |
|------|---------|
| `~/.port-daddy/daemon.sock` | HTTP Unix socket (CLI, SDK, MCP) |
| `~/.port-daddy/daemon.ipc` | Binary IPC socket (agent hot path) |
| `~/.port-daddy/daemon.pid` | PID file |
| `~/.port-daddy/daemon.port` | TCP port file (dashboard discovery) |
| `~/.port-daddy/master.key` | AES-256-GCM master key for note encryption |
| `~/.port-daddy/ui-preferences.json` | Shared UI preferences (FleetBar menu bar companion) |

Override via environment variables: `PORT_DADDY_SOCK`, `PORT_DADDY_IPC`, `PORT_DADDY_PORT_FILE`.

## CLI Quick Reference

| Command | Purpose |
|---------|---------|
| **Session Lifecycle** | |
| `pd begin` / `pd done` | Start/end session (agent registration included) |
| `pd whoami` | Current agent and session context |
| `pd note` / `pd notes` | Write/read immutable notes |
| **Port Management** | |
| `pd claim` / `pd release` | Claim/release deterministic ports |
| `pd find` | Wildcard service search (trie-accelerated) |
| **Coordination** | |
| `pd lock` / `pd unlock` | Distributed locks |
| `pd with-lock` | Run command under lock with auto-release |
| `pd pub` / `pd watch` | Pub/sub messaging |
| `pd session files claim` | Advisory file claims |
| **Fleet & Agents** | |
| `pd fleet init` | Create pd-fleet.yml + git hook |
| `pd fleet up/down/status/validate` | Start/stop/inspect/dry-run the fleet (CLI-attached mode) |
| `pd sortie` / `pd sortie list/status/logs` | Launch and inspect tracked mission records |
| `pd spawn` / `pd spawned` | Launch/list background agents |
| `pd spawn kill` | Kill a spawned agent |
| `pd salvage` | Dead agent recovery |
| **Fleet Daemon HTTP** | |
| `GET /fleet` | Aggregated daemon fleet status (all projects) |
| `GET /fleet/:project` | Status for a specific project's fleet |
| `POST /fleet/start\|stop\|reload` | Manage daemon-managed fleets |
| `POST /fleet/register` | Register project dir for fleet management |
| `GET /fleet/events` | SSE stream of fleet lifecycle events |
| `GET /fleet/prompt` | One-line fleet status for shell prompt (query: `project`) |
| `GET /fleet/config/:project` | Raw YAML + parsed config + topology validation |
| `PUT /fleet/config/:project` | Write YAML config, validate, reload fleet |
| `GET /fleet/models` | Supported backends + model catalog + readiness hints (probes Ollama live) |
| **Swarm Memory** | |
| `pd tuple out/rd/in` | Write/read/take tuples |
| `pd tuple scan/count` | List/count tuples |
| `pd pheromone spray` | Set ambient signal on an entity |
| `pd pheromone sniff` | Read pheromone values (with decay) |
| `pd pheromone list` | List all non-zero pheromones |
| `pd pheromone files` | File heat map |
| **Observability (HTTP API)** | |
| `GET /metrics/golden` | Fleet health: rate, errors, duration, cost/hr (RED method) |
| `GET /metrics/cost` | Cost summary by project + backend (default: 24h) |
| `GET /metrics/cost/budget/:project` | Budget check — spend vs. ceiling |
| `GET /metrics/counters` | Counter summary or time-bucketed single key |
| `GET /metrics/counters/top` | Top N dimension values for a counter |
| `GET /metrics/cost/recent` | Most recent cost events |
| **System** | |
| `pd setup` | One-command onboarding (daemon + MCP + FleetBar + project init) |
| `pd status` | Daemon health |
| `pd version` | Version and code hash |
| `pd arbiter status` | Invariant enforcement status |
| `pd arbiter violations` | List recorded violations |
| `pd dev start/stop/status` | Isolated dev daemon (port 9877) |

## Decision Matrix: Which Tool When

| Problem | Solution |
|---------|----------|
| First-time setup (daemon + MCP + FleetBar) | `pd setup` |
| Dev server port conflict | `pd claim myapp:api -q` |
| Need to coordinate with other agents | `pd begin` + `pd session files claim` |
| Agent-to-agent signaling | `pd pub` + `pd watch` |
| Direct message to a specific agent | `talk_to_agent` MCP tool or `pd inbox send` |
| Background automation (terminal-attached) | `pd fleet init` + `pd fleet up` |
| Background automation (always-on, survives terminal) | Place `pd-fleet.yml` in registered project; daemon auto-starts it |
| Reload fleet after editing pd-fleet.yml | `PD_URL="\${PORT_DADDY_URL:-http://localhost:9876}"; curl -XPOST "$PD_URL/fleet/reload"` or `kill -HUP <daemon-pid>` |
| Share knowledge across agents | `pd tuple out` / `pd tuple rd` |
| Track "hotness" of resources | `pd pheromone spray` / `sniff` |
| See file contention at a glance | `file_heat` MCP tool or `pd pheromone files` |
| Crashed agent left work behind | `pd salvage` |
| Exclusive operations (deploys, migrations) | `pd with-lock` |
| What happened while I was away? | `catch_me_up` MCP tool |
| Who else is working right now? | `swarm_awareness` MCP tool |
| Check for invariant violations | `pd arbiter status` |
| How much are my fleet agents costing? | `PD_URL="\${PORT_DADDY_URL:-http://localhost:9876}"; curl "$PD_URL/metrics/cost"` |
| Is a project over budget? | `PD_URL="\${PORT_DADDY_URL:-http://localhost:9876}"; curl "$PD_URL/metrics/cost/budget/myapp?budgetUsdPerDay=5"` |
| Fleet health at a glance (RED signals) | `PD_URL="\${PORT_DADDY_URL:-http://localhost:9876}"; curl "$PD_URL/metrics/golden"` |
| Top backends by spawn count | `PD_URL="\${PORT_DADDY_URL:-http://localhost:9876}"; curl "$PD_URL/metrics/counters/top?key=spawn.started&dim=backend"` |
| Show fleet status in shell prompt | `PD_URL="\${PORT_DADDY_URL:-http://localhost:9876}"; curl "$PD_URL/fleet/prompt?project=myapp"` |
| Read/edit fleet config via API | `GET /fleet/config/myapp` or `PUT /fleet/config/myapp` with `{ "yaml": "..." }` |
| What LLM backends are available? | `PD_URL="\${PORT_DADDY_URL:-http://localhost:9876}"; curl "$PD_URL/fleet/models"` |

## Delegation Reference

If you are choosing between launch surfaces, use `docs/DELEGATION-MODES.md` as the source of truth. It explains when to use `pd spawn`, `pd agent`, `pd sortie`, `pd fleet`, and how harbors fit in.

## Common Issues

### Port Daddy daemon not running
**Symptom:** `Connection refused` on any pd command
**Fix:** `pd start` or `pd install` (installs as launchd service, auto-starts on login)

### Port already claimed
**Symptom:** You get a port but it's the "wrong" one
**This is correct behavior.** Same identity = same port, always. If you need a different port, use a different identity context: `myapp:api:feature-x` instead of `myapp:api:main`.

### Session already active
**Symptom:** `pd begin` says a session exists
**Fix:** Call `pd whoami` to see the current session. Either `pd done` the old one or continue working in it.

### File claim conflicts
**Symptom:** Another agent claimed files you need
**Fix:** This is the system working. Check `pd swarm_awareness` to see who owns what. Coordinate via `pd pub` or work on different files.

### IPC connection failures
**Symptom:** IPC-related errors in logs
**Fix:** The SDK falls back to HTTP automatically. IPC is an optimization, not a requirement. Check that `~/.port-daddy/daemon.ipc` exists and has correct permissions (should be user-only, created by the daemon).

## For More Details

Consult `references/api-reference.md` for the full HTTP API (93+ endpoints).
Consult `references/sdk-reference.md` for the JavaScript SDK.
Consult `references/multi-agent-patterns.md` for advanced coordination patterns (leader election, pipeline stages, etc.).
