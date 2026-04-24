# ⚓ Port Daddy (v3.9.0)

<p align="center">
  <img src="website-v2/public/img/hero-portdaddy.png" alt="Port Daddy — the harbormaster for your AI agents" width="600">
</p>

<p align="center">
  <strong>Stop your agents from fighting each other.</strong><br />
  Atomic port assignment, session coordination, pub/sub messaging, and agent resurrection — one daemon, zero config.
</p>

<p align="center">
  <a href="https://npmjs.com/package/port-daddy"><img src="https://img.shields.io/npm/v/port-daddy.svg?logo=npm&color=3AADAD" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-FSL--1.1--MIT-blue?color=3AADAD" alt="license"></a>
  <a href="https://github.com/curiositech/port-daddy"><img src="https://img.shields.io/badge/tests-3,700%2B%20passing-brightgreen?logo=jest&color=3AADAD" alt="tests"></a>
  <a href="https://github.com/curiositech/port-daddy/tree/main/skills/port-daddy-cli"><img src="https://img.shields.io/badge/AI%20Agents-40%2B%20compatible-blueviolet?logo=openai&color=3AADAD" alt="AI Agent Skill"></a>
  <a href="http://dashboard.pd.local:3144"><img src="https://img.shields.io/badge/Local--DNS-Active-success?logo=lighthouse&color=3AADAD" alt="Local DNS"></a>
</p>

---

## Overview

**Port Daddy** is a daemon that gives every AI agent its own port, coordinates file access, and recovers work when they crash. One install, zero config.

Examples in this README assume the default local daemon URL `http://localhost:9876`. If your daemon is running on a different port, use `pd status` or set `PORT_DADDY_URL` before copying the HTTP examples.

While individual agents are brilliant, **coordination** is the bottleneck. Port Daddy provides the missing primitives: atomic port assignment, pub/sub messaging, distributed locks, session trails, and agent resurrection.

```bash
# Start working (registers agent + claims port + starts session)
pd begin "Building the auth layer" --identity myapp:api

# Log progress, coordinate with other agents
pd note "JWT validation passing all tests"
pd pub api:ready '{"endpoints": ["/login", "/register"]}'

# Done (ends session + releases everything)
pd done "Auth complete"
```

### ⚓ Key Primitives
- **Atomic Port Assignment:** Zero race conditions. Semantic identities (e.g., `myapp:api`) map to stable, deterministic ports.
- **Swarm Radio (Pub/Sub):** Low-latency, SSE-backed messaging for inter-agent signaling using **Maritime Signal Flags**.
- **Agentic Control Plane:** A live 2D/3D dashboard (`*.pd.local`) to visualize active agents, service health, and message traffic.
- **Automatic Salvage:** Captures session state and notes from "zombie" agents that crash mid-task, allowing others to recover their work.
- **Local DNS Resolver:** Access your services at `http://api.pd.local` instead of magic port numbers.
- **Binary IPC:** High-frequency agent communication over Unix domain socket with MessagePack encoding, FIPA-grounded performatives, and 20 documented failure mode mitigations.

---

## 🧭 Table of Contents
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Multi-Agent Coordination](#-multi-agent-coordination)
- [The Dashboard (HUD)](#-the-dashboard-hud)
- [Configuration](#-configuration)
- [Patterns & Cookbook](#-patterns--cookbook)
- [Development & Testing](#-development--testing)
- [V4 Roadmap: The Wild West](#-v4-roadmap-the-wild-west)
- [License](#-license)

---

## 📦 Installation

### 1. Requirements
- **OS:** macOS (recommended) or Linux.
- **Runtime:** Node.js v18+.

### 2. Install CLI
```bash
# Via Homebrew (macOS)
brew install curiositech/tap/port-daddy

# Via npm
npm install -g port-daddy
```

### 3. Verify
```bash
pd doctor   # Verify environment
pd start    # Start the daemon
pd bench 50 # Run performance benchmarks (Target: <1ms latency)
```

---

## 🚀 Quick Start

### The One-Liner
Stop hardcoding ports in your shell scripts. Use `pd claim`:
```bash
# Claim a stable port for your project
PORT=$(pd claim myapp -q) npm run dev -- --port $PORT
```

### Starting the Stack
Port Daddy scans your project and builds a dependency graph automatically:
```bash
pd scan   # Detects 60+ frameworks and generates .portdaddyrc
pd up     # Starts all services in dependency order with color-coded logs
```

### 🚁 Swarm Coordination
- **pd begin / pd done**: Track **session_phases** (planning, in_progress, etc.).
- **pd demo**: Interactive multi-agent coordination **demo**.
- **pd fleet**: Declarative agent **fleet** from `pd-fleet.yml` — cron/trigger-based agents with pub/sub chaining.
- **pd status / pd version**: View system **info** and metrics.

### Session Lifecycle
Every work session progress through defined **Phases** for clear swarm visibility:
- `planning`: Scoping the task.
- `in_progress`: Active development.
- `testing`: Verification in progress.
- `reviewing`: Awaiting human or agent approval.
- `completed` / `abandoned`: Final state reached.

---

## 🏥 Diagnostics & Status

### System Health
Monitor the heartbeat of your control plane:
```bash
pd status   # Authoritative daemon truth: runtime state, build hash, fleet counts, guardian status
pd version  # Version, code hash, install dir, PID
curl http://127.0.0.1:9876/status   # Full daemon report including recent activity and spend
```

`launchctl` is the canonical supervisor on macOS. Bosun is the optional non-agent watchdog; the daemon now writes a filesystem heartbeat for it, and the old Barnacle sidecar remains only as a deprecated compatibility implementation name during the V4 rollout.

---

## 📡 Multi-Agent Coordination

Port Daddy is built for the "Wild West" of agentic workflows where agents hail each other ad-hoc.

### Swarm Radio (Pub/Sub)
Agents speak to each other over named channels using maritime signals:
```bash
# Declare a canonical channel for this repo/worktree first
pd channels ensure swarm:general --scope branch --aliases general:swarm

# Discover what already exists in the current worktree
pd channels discover swarm

# Subscribe using the logical name — the CLI resolves it to the current worktree's physical channel
pd sub swarm:general

# Publish a "Mayday" signal from another terminal
pd pub swarm:general \
  "Auth service is flatlining" \
  --signal mayday \
  --sender "NAVIGATOR"
```

Declared channels are git-sensitive by default. A branch-scoped channel resolves differently across worktrees/feature branches, which stops unrelated branches from accidentally sharing the same coordination bus. `pd pub`, `pd sub`, `pd watch`, and `pd channels clear` all auto-resolve declared logical names against the current worktree. Use `--raw-channel` only when you intentionally want the literal channel string without resolution.

### Integration & Signaling
Automate agent handoffs using `pd integration` and `pd wait`:
```bash
pd integration ready myapp:api  # Signal that API is ready
pd wait myapp:api               # Block until service becomes healthy
```

### Observation & History
Keep track of swarm state with `pd briefing`, `pd changelog`, and `pd activity`:
```bash
pd briefing    # Get a project-level context summary
pd changelog   # View the hierarchical history of changes
pd activity    # Stream the raw audit trail of all operations
```

### Say / Look (3.8.4) — The Consolidated Verbs
When you return to work after a break, or when you want to tell every other
session about a finding, reach for these two verbs instead of stitching
together `pd note`/`pd tuple`/`pd pheromone`/`pd pub` by hand:

```bash
# Say — one text, many fan-outs. Defaults to a session note.
pd say "fixed flash of unstyled content on hydrate in Hero.tsx" \
       --pin --heat website-v2/src/components/landing/Hero.tsx=0.7
#   ^note              ^tuple (cross-session)   ^pheromone heat on the file

# Also publish on a pub/sub channel:
pd say "build broken on main, rolling back" --broadcast alerts

# Look — situation report. What happened while I was away?
pd look --since 30                 # last 30m synthesis
pd look --heat                     # file heat map (pheromone contention)
pd sitrep                          # explicit maritime-voice alias
```

`pd say` flags compose — `--pin --heat path=0.8 --broadcast alerts` is four
HTTP calls in parallel from a single command. `pd look` returns a four-way
synthesis (activity + notes + salvage queue + spawned agents) with a
one-line `summary` suitable for shell prompts.

### Webhooks & Life Cycles
- **Webhooks:** `pd webhooks` subscribe external systems to swarm events.
- **Phases:** Track work via `planning`, `testing`, and `reviewing` session phases.

### Spawn AI Agents
Launch AI agents with full PD coordination (registration, sessions, heartbeats) baked in:
```bash
# Current operator-facing launchable path: Claude SDK with an exact-rate model
pd spawn \
  --backend claude \
  --model claude-haiku-4-5-20251001 \
  --budget 0.50 \
  --identity myapp:fixer \
  -- "Summarize the latest auth diff"

# Another exact-telemetry Claude run
pd spawn \
  --backend claude \
  --model claude-haiku-4-5-20251001 \
  --budget 0.35 \
  --identity myapp:docs \
  -- "Explain what this function does"

# `pd agent` and `pd sortie` run spawn preflight internally before launch
pd agent "Explain what changed in the auth flow" \
  --backend claude \
  --model claude-haiku-4-5-20251001 \
  --budget 0.35

# List running/completed agents
pd spawned

# Kill a running agent
pd spawn kill <agent-id>

# Watch a logical channel and auto-trigger scripts
pd watch git:committed --exec './fleet/qa-adversary.sh'
```

Operator-facing launches are fail-closed on telemetry. Port Daddy rejects a launch unless it can attach exact token counts, an exact nonzero rate, and a persisted exact nonzero cost record to the completed run.

Today that means the live launchable path is the Claude SDK backend with an exact-rate model entry. Other backend integrations still exist in source, but they should be treated as blocked until they reach the same telemetry standard.

Internal code paths use the same rule: `createSpawner()` defaults telemetry enforcement on, and any explicit `enforceTelemetryPolicy: false` bypass now requires HITL confirmation metadata instead of relying on an omitted flag.

**Backends in source:** `ollama`, `claude`, `claude-cli`, `gemini`, `cloudflare`, `codex`, `aider`, `custom`

**Key flags:** `--backend`, `--model`, `--tier`, `--identity`, `--purpose`, `--budget`, `--allowedTools` (claude-cli), `--maxTokens`, `--workdir`, `--timeout`

Quiet mode (`-q`) prints raw output to stdout and exits non-zero on failure — perfect for shell scripts:
```bash
local result=$(pd spawn --backend claude --model claude-haiku-4-5-20251001 --budget 0.25 -q -- "Write a commit message for: $diff")
```

### Delegation Modes

Use the right surface for the job:

- `pd spawn` — the low-level primitive. Explicit backend, identity, budget, and task.
- `pd agent` — the preferred single-agent sugar. One bounded task with Port Daddy coordination wrapped around it.
- `pd sortie` — a tracked mission record with a durable id, event log, harbor, and inspectable outcome.
- `pd fleet` — always-on project automation from `pd-fleet.yml`.

Canonical operator explanation: [docs/DELEGATION-MODES.md](docs/DELEGATION-MODES.md)

```bash
# Preferred single-agent delegation
pd agent "Review the last commit for regressions" \
  --backend claude \
  --model claude-haiku-4-5-20251001 \
  --budget 0.35

# Tracked mission record with status + logs
pd sortie "Investigate flaky auth tests and summarize the root cause" \
  --backend claude \
  --model claude-haiku-4-5-20251001 \
  --budget 0.75

# Inspect mission outcomes later
pd sortie list
pd sortie status sortie-abc123
pd sortie logs sortie-abc123
```

Current truthful limitation: `pd sortie` is now a first-class mission object and CLI/API/MCP surface, but the underlying execution is still a single coordinating spawned agent. Richer multi-agent approvals, artifact/result pages, and human-in-the-loop controls are the next layer.

### OpenAPI Specification
Full API spec at `docs/openapi.yaml` (OpenAPI 3.1, 96 paths, 125 operations):
```bash
cat docs/openapi.yaml    # Machine-readable API contract
```

### Agent Inboxes (SSE Watch)
Every agent (or human) can stream their personal inbox live:
```bash
# Stream your inbox in real-time
pd inbox watch --agent CAPTAIN

# Send a DM to the captain
pd inbox send CAPTAIN "Course corrected. Heading 270." --sender "PILOT"
```

### Agent Identity & Auto-Salvage
Register with a semantic identity so Port Daddy can track your project context:
```bash
# Register with identity — enables context-aware salvage
pd agent register --agent build-42 --identity myapp:api --purpose "Building auth module"

# If another agent in myapp:* died, you'll see:
#   ⚠  2 dead agent(s) in myapp:*. Run: pd salvage --project myapp

# View dead agents scoped to your project
pd salvage --project myapp

# Pick up a dead agent's work
pd salvage claim dead-agent-99
```

When an agent dies (crashes, loses connection, context exceeded), its sessions and notes are preserved. New agents in the same project are automatically notified at registration.

### Distributed Locks
Prevent agents from "stepping on" each other's files or DB migrations:
```bash
pd with-lock db-migrations -- npm run migrate
```

### The Arbiter (Runtime Invariant Enforcement)
The Arbiter monitors every state transition against 6 formally-derived invariants:
```bash
# Check arbiter status
curl http://localhost:9876/arbiter/status

# Inject a test violation (for demos)
curl -X POST http://localhost:9876/arbiter/test-invariant/NOTE_MONOTONICITY
```
Rules: PID squatting, capability escalation, note monotonicity, escrow positivity, lock owner validity, heartbeat freshness. In strict mode, critical violations trigger man-overboard salvage.

### Pheromone Trails (Ambient Signals)
Agents spray numeric signals (0-1) onto entities. Signals decay over time at read, creating ambient awareness:
```bash
# Spray a signal onto a service
pd pheromone spray --table services --id myapp:api --key urgency --strength 0.8

# Sniff pheromone values (applies read-time decay)
pd pheromone sniff --table services --id myapp:api

# View file heat map (which files are most contested)
curl http://localhost:9876/pheromone/files

# List all non-zero pheromone trails
pd pheromone list
```

Use cases: adaptive Arbiter thresholds, file contention detection, agent reputation scoring, hot-path identification.

### Tuple Space (Shared Swarm Memory)
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
```

Pattern matching: exact values, `*` wildcard, `>N`/`<N` numeric comparisons, `myapp:*` semantic identity prefixes.

### Semantic Graph And Episodic Memory
Port Daddy now exposes two operator inspection surfaces over the newer coordination substrate:

- `pd graph` for durable relationship edges emitted by symbol indexing and merge orchestration
- `pd memory` for promoted handoffs, findings, blockers, and sortie outcomes

```bash
# Inspect graph relationships for one indexed file
pd graph edges --scope symbols:file:/Users/you/coding/port-daddy/server.ts

# Summarize graph density for a project
pd graph stats --dir /Users/you/coding/port-daddy

# Review promoted handoffs/findings
pd memory episodes --project port-daddy --type handoff

# Summarize episodic memory coverage
pd memory stats --dir /Users/you/coding/port-daddy
```

These are read surfaces for now. The point is operator truth: if graph/memory is part of the product, it must be inspectable from the CLI and not only via raw daemon routes.

### Semantic Trie (O(k) Identity Lookups)
Port Daddy indexes all identities (services, agents, sessions, harbors) in an in-memory Adaptive Radix Tree. Lookups are O(k) where k is key length — replacing SQL `LIKE` scans that degrade as the registry grows.

```bash
# These all resolve through the trie, not SQL:
pd find 'myapp:*'              # Prefix search — all services under myapp
pd find 'myapp:*:main'         # Wildcard — all stacks with context "main"
pd find 'myapp:api:main'       # Exact lookup
```

The trie populates from SQLite on daemon startup and stays in sync on every register/claim/release. Harbor bitmask filtering enables O(1) scope checks for harbor membership.

### Fleet Engine (Declarative Agent Orchestration)
Declare your background agent fleet in a `pd-fleet.yml` file — like docker-compose for AI agent swarms. **As of v3.8.3, the Port Daddy daemon auto-discovers and starts your fleet on boot** — no terminal to keep open.

```yaml
# pd-fleet.yml
fleet:
  name: my-project-dev
  harbor: "{project}:fleet"

  limits:
    max_concurrent_spawns: 2        # At most 2 agents running in parallel
    max_spawns_per_hour: 20         # Rate cap (Ostrom Principle 2)
    budget_usd_per_day: 5           # Daily LLM spend ceiling in USD

  agents:
    qa:
      trigger: git:committed          # React to pub/sub events
      backend: claude
      model: claude-haiku-4-5-20251001
      prompt: |
        Review the most recent commit. Find bugs. Write tests.

    test-hunter:
      trigger: git:committed
      backend: claude
      model: claude-haiku-4-5-20251001
      prompt: |
        Run the test suite. Fill the highest-signal coverage gaps.

    gardener:
      schedule: "*/10 * * * *"        # Or run on a cron schedule
      backend: claude
      model: claude-haiku-4-5-20251001
      prompt: "Summarize the current repo status and suggest the next maintenance action."
      on_success: publish git:status  # Chain agents via channels

  channels:
    git:committed:
      description: "Fired after a successful commit"
      consumers: [qa]
```

**Two fleet modes:**
- **CLI mode** (`pd fleet up`): Manual, runs while your terminal session is open.
- **Daemon mode** (automatic): The Port Daddy daemon scans known Port Daddy repos on boot and starts any discovered `pd-fleet.yml` fleets automatically. Known repos come from durable repo markers such as `pd-fleet.yml`, `.portdaddyrc`, or `.portdaddy/`, plus live runtime state. Survives terminal close, system sleep, and daemon restarts (via launchd `KeepAlive`). Editing `pd-fleet.yml` triggers a hot-reload automatically.

```bash
# CLI mode
pd fleet init     # Create pd-fleet.yml + git post-commit hook (first-time setup)
pd fleet up       # Start all agents (foreground, terminal-attached)
pd fleet validate # Parse YAML, resolve templates, and dry-run topology checks
pd fleet status   # View running agents
pd fleet down     # Stop all agents

# Daemon mode (always-on)
curl http://localhost:9876/fleet              # Global fleet status
curl -X POST http://localhost:9876/fleet/reload   # Reload all configs (same as SIGHUP)
curl http://localhost:9876/fleet/events       # SSE stream of lifecycle events

# Fleet config management
curl http://localhost:9876/fleet/config/myapp           # Read YAML + topology validation
curl -X PUT http://localhost:9876/fleet/config/myapp \
  -H 'Content-Type: application/json' \
  -d '{"yaml": "fleet:\n  name: myapp\n  agents: ..."}' # Write + validate + reload

# Shell prompt integration
curl 'http://localhost:9876/fleet/prompt?project=myapp'  # One-line status for PS1

# Available backends & models
curl http://localhost:9876/fleet/models       # Lists ollama, codex, claude-cli, gemini, cloudflare, aider, etc.
```

Each agent gets full PD coordination for free: registration, sessions, heartbeats, and salvage on crash. Fleet YAML can still describe the broader source backend catalog, but the daemon applies the same fail-closed telemetry policy as manual launches. In practice, treat Claude SDK + exact-rate model entries as the currently runnable operator-facing path until the other backends reach telemetry parity. Template variables (`{project}`) resolve from the YAML context. Fleet lifecycle events publish to the `fleet:events` channel for dashboard and menu bar subscriptions.

Fleet status now reflects mailbox semantics: repeated trigger bursts collapse into queued work instead of spawning a fresh agent for every wake. When that happens, agent rows can show `status: queued` and a non-zero `queueDepth` so operators can see pending work instead of mistaking it for a miss.

The daemon-served control plane now has an explicit `Agents` surface alongside the fleet graph. It is the operator view for all agents in a project slice: configured fleet agents, live registry entries, spawned runs, salvage ghosts, inbox traffic, recent sessions/notes, known pub/sub bindings, and active file claims.

### Bonds & Budget Guard

Port Daddy escrows virtual USD before each agent spawn and can SIGTERM live spawns that breach their daily budget. Spend is observable (cost-tracker); enforcement is separate (bonds). You top up a project wallet; every spawn debits a small bond; clean exits refund it; misbehavior slashes it. `pd fleet panic` arms a two-step global kill-switch that **refunds** (not slashes) every running bond — operator action is not agent misbehavior.

**What the wallet actually is.** The wallet is a *governance accounting unit*, not money. No payments move; no refunds reach a bank. The "USD" numbers are accounting units denominated against `cost-tracker`'s estimated LLM spend. When the backend is `claude` (SDK → real API), `codex`, `gemini`, or `cloudflare`, those dollars map to real per-token billing. When the backend is `claude-cli` (your Claude Code subscription) or `ollama` (local), per-token marginal cost is ~$0 and bonds become a coordination signal — a quota, a kill-switch, a priority ordering, and an audit trail. Useful, but don't pretend it's money.

**Spawning requires a daily budget.** Every project must set `usd_per_day` before its first spawn; the daemon refuses unbonded agents. Run `pd wallet budget <project> --usd-per-day 5` during project setup. The no-budget-no-spawn rule is an Ostrom-style monitoring invariant: no agent can run without a number to enforce against.

**Budget breach is pause-and-ask, not cliff SIGTERM.** The manifest feature is `budget_guard`: when a spawn crosses 100% of its project's daily budget, Port Daddy posts a *pending kill* with a 60-second grace window and broadcasts on `budget:pending`. During grace, the operator has three options: `raise` (credit the wallet + optionally bump the budget, agent keeps running), `kill` (skip the wait, fire SIGTERM now), or `grace` (extend the window — up to 2 extensions). If nothing happens, the backstop SIGTERM fires at expiry. List pending kills with `pd wallet pending`; resolve one with `pd wallet raise --agent <id> --usd 5`.

```bash
# Top up and inspect
curl -X POST http://localhost:9876/wallets/myapp/top-up \
  -H 'Content-Type: application/json' -d '{"usd": 20}'
curl 'http://localhost:9876/bonds?project=myapp&state=running'

# Manually slash a misbehaving agent's bond (audited)
curl -X POST http://localhost:9876/bonds/42/slash \
  -H 'Content-Type: application/json' \
  -d '{"portion": 0.5, "reason": "leaked secrets to stdout"}'

# Two-step panic
curl -X POST http://localhost:9876/fleet/panic \
  -H 'Content-Type: application/json' -d '{"reason": "runaway loop"}'
curl -X POST http://localhost:9876/fleet/panic \
  -H 'Content-Type: application/json' \
  -d '{"reason": "runaway loop", "confirm": true}'
curl -X POST http://localhost:9876/fleet/unpanic \
  -H 'Content-Type: application/json' -d '{"reason": "root cause fixed"}'
```

Or via CLI: `pd wallet top-up myapp --usd 20`, `pd bond list --project myapp`, `pd fleet panic --reason "runaway"`.

### Observability & Cost Tracking

Port Daddy tracks operational metrics and LLM spend across your fleet. Three subsystems work together:

**Counters** — ODS-style bump counters with time-bucketed storage. The daemon auto-increments counters for spawn lifecycle events (`spawn.started`, `spawn.failed`, `spawn.completed`, `spawn.duration_ms`), session events, and more. Batched in memory, flushed to SQLite every 10s. Auto-prunes rows older than 30 days.

**Cost Tracker** — Records per-spawn LLM cost. Operator-facing launches are accepted only when Port Daddy can persist exact token counts plus an exact nonzero rate-derived cost record. Historical `/metrics/cost` buckets may still include legacy estimated sessions from older runs, but new daemon-managed launches are supposed to fail closed instead of adding fresh opaque estimates. Budget checks remain project-scoped.

**Golden Signals** — RED method metrics for the spawn system in a single endpoint: rate/min, error%, avg duration, cost/hr burn rate.

```bash
# Golden signals — one-stop health check for your fleet
curl http://localhost:9876/metrics/golden
# → { ratePerMin: 1.2, errorPct: 5.0, avgDurationMs: 4200, costPerHour: 0.23 }

# Cost summary by project (last 24h)
curl http://localhost:9876/metrics/cost
# → { totals: { totalUsd: 2.15, spawns: 43 }, byProject: [...], byBackend: [...] }

# Budget check — explicit ceiling required on every query
curl "http://localhost:9876/metrics/cost/budget/myapp?budgetUsdPerDay=10"

# Counter time series — spawn rate by minute
curl "http://localhost:9876/metrics/counters?key=spawn.started&groupBy=minute"

# Top backends by spawn count
curl "http://localhost:9876/metrics/counters/top?key=spawn.started&dim=backend&n=5"

# Recent cost events (live feed)
curl http://localhost:9876/metrics/cost/recent?limit=20
```

### Note Encryption (Escrow Secrecy)
Session notes are encrypted at rest with AES-256-GCM. Master key stored at `~/.port-daddy/master.key` (auto-generated on first boot). Per-session keys wrapped with the master key. Backward-compatible — existing plaintext notes remain readable. ProVerif-verified: attacker with database access cannot learn note content.

### White Papers
Two formal white papers are available at `/whitepaper` on the website:
- **The Anchor Protocol** — Formally verified cryptographic identity for agent swarms (ProVerif + Kani/Rust)
- **The Bonded Commons** — Pre-transactional trust infrastructure: Hobbes, Sen's impossibility, collateralized work contracts

---

## 🎛️ The Dashboard (HUD)

Access the high-density **Orchestration Control Panel** locally:
- **URL:** `http://dashboard.pd.local:3144`
- **Immersive 3D:** Toggle the **3D Swarm** view to see your agents and services as a spatial force-directed graph.
- **Swarm Radio:** A unified timeline merging infrastructure events, agent notes, and real-time message traffic.

---

## ⚙️ Configuration

### `.portdaddyrc`
Commit this to your repo so every developer gets the same deterministic port mapping.
```json
{
  "project": "payment-pro",
  "services": {
    "api": {
      "cmd": "npm run dev:api -- --port ${PORT}",
      "healthPath": "/health"
    },
    "web": {
      "cmd": "next dev --port ${PORT}",
      "needs": ["api"]
    }
  }
}
```

### Environment Variables
- `PORT_DADDY_URL`: Daemon address (Default: `http://localhost:9876`)
- `PORT_DADDY_RANGE_START`: Port pool start (Default: `3100`)

---

## 📖 Patterns & Cookbook

| Pattern | Goal |
|---------|------|
| **Leader Election** | Use locks to appoint a single master agent in a worker swarm. |
| **P2P Handshake** | Use inboxes as signaling servers to establish high-bandwidth WebRTC tunnels. |
| **Agentic Escrow** | Hold lock-backed payouts until an Arbiter agent verifies work quality. |
| **The Brig** | Automatically isolate or salvage agents who deviate from their manifest. |

*See `/cookbook` on the local dashboard for full code examples.*

---

## 🛠️ Development & Testing

### Setup
```bash
git clone https://github.com/curiositech/port-daddy
npm install
npm run dev # Starts daemon and website in dev mode
```

### Quality Gates
We maintain an extreme standard of reliability for the control plane:
- **Test Suite:** 3,700+ passing tests.
- **Formal Verification:** Roadmap includes **ProVerif** modeling for the Anchor Protocol.
- **Benchmarking:** `pd bench` measures atomic commit latency.

---

## 🗺️ V4 Roadmap: The Wild West

As swarms move beyond local machines, we are building the **Code of the Sea** for agents:
- **Float Plans & Manifests:** Pre-declaration of agent intent and resource needs.
- **Ephemeral FUSE Harbors:** Harbor-specific data storage that shreds upon departure.
- **Agent OAuth:** Cryptographic identity verification for remote P2P coordination.
- **Noise Protocol Tunnels:** Secure, encrypted P2P tunnels between remote Port Daddy instances.

---

## ⚖️ License

**FSL-1.1-MIT** — (Functional Source License).
Free for development and internal use. See [LICENSE](LICENSE) for details.

Created by **[Erichs Owens](https://github.com/erichowens)** at **[curiositech](https://curiositech.ai)**.

---

## ⚓ Support & Contact
- **Issues:** [GitHub Issue Tracker](https://github.com/curiositech/port-daddy/issues)
- **Help:** Run `pd help` or `pd learn` for the interactive tutorial.
- **Vibe:** Ambitious, CUTE and CHARMING. 🚩
