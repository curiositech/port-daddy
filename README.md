# ⚓ Port Daddy (v3.8.2)

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
pd status   # Quick overview of daemon and services
pd version  # Check for stale code and FFI health
pd health   # Authoritative report from the Barnacle (Port 9875)
```

---

## 📡 Multi-Agent Coordination

Port Daddy is built for the "Wild West" of agentic workflows where agents hail each other ad-hoc.

### Swarm Radio (Pub/Sub)
Agents speak to each other over named channels using maritime signals:
```bash
# Subscribe to the swarm signal
pd sub swarm:general

# Publish a "Mayday" signal from another terminal
pd pub swarm:general "Auth service is flatlining" --signal mayday --sender "NAVIGATOR"
```

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

### Webhooks & Life Cycles
- **Webhooks:** `pd webhooks` subscribe external systems to swarm events.
- **Phases:** Track work via `planning`, `testing`, and `reviewing` session phases.

### Spawn AI Agents
Launch AI agents with full PD coordination (registration, sessions, heartbeats) baked in:
```bash
# Claude Code CLI (full agent with file editing tools)
pd spawn --backend claude-cli --allowedTools 'Read,Write,Edit,Glob,Grep' -- "Fix the login bug in src/auth.ts"

# Claude API (text in, text out — fast, no tools)
pd spawn --backend claude -- "Explain what this function does"

# Ollama (local LLM, default)
pd spawn --backend ollama --model llama3.2:8b -- "Summarize the README"

# List running/completed agents
pd spawned

# Kill a running agent
pd spawn kill <agent-id>

# Watch a channel and auto-trigger scripts
pd watch git:committed --exec './fleet/qa-adversary.sh'
```

**Backends:** `ollama` (default), `claude` (API), `claude-cli` (full CLI), `gemini`, `aider`, `custom`

**Key flags:** `--backend`, `--model`, `--identity`, `--purpose`, `--allowedTools` (claude-cli), `--maxTokens`, `--workdir`, `--timeout`

Quiet mode (`-q`) prints raw output to stdout and exits non-zero on failure — perfect for shell scripts:
```bash
local result=$(pd spawn --backend claude-cli --maxTokens 100 -q -- "Write a commit message for: $diff")
```

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
Declare your background agent fleet in a `pd-fleet.yml` file — like docker-compose for AI agent swarms. **As of v3.8.2, the Port Daddy daemon auto-discovers and starts your fleet on boot** — no terminal to keep open.

```yaml
# pd-fleet.yml
fleet:
  name: my-project-dev
  harbor: "{project}:fleet"

  limits:
    max_concurrent_spawns: 2        # At most 2 agents running in parallel
    max_spawns_per_hour: 20         # Rate cap (Ostrom Principle 2)

  agents:
    qa:
      trigger: git:committed          # React to pub/sub events
      backend: claude-cli
      allowedTools: "Read,Grep,Glob,Bash(npm test*)"
      prompt: |
        Review the most recent commit. Find bugs. Write tests.

    gardener:
      schedule: "*/10 * * * *"        # Or run on a cron schedule
      backend: custom
      prompt: "git status --porcelain"
      on_success: publish git:status  # Chain agents via channels

  channels:
    git:committed:
      description: "Fired after a successful commit"
      consumers: [qa]
```

**Two fleet modes:**
- **CLI mode** (`pd fleet up`): Manual, runs while your terminal session is open.
- **Daemon mode** (automatic): The Port Daddy daemon scans all registered projects for `pd-fleet.yml` on boot and starts their fleets automatically. Survives terminal close, system sleep, and daemon restarts (via launchd `KeepAlive`). Editing `pd-fleet.yml` triggers a hot-reload automatically.

```bash
# CLI mode
pd fleet init     # Create pd-fleet.yml + git post-commit hook (first-time setup)
pd fleet up       # Start all agents (foreground, terminal-attached)
pd fleet status   # View running agents
pd fleet down     # Stop all agents

# Daemon mode (always-on)
curl http://localhost:9876/fleet              # Global fleet status
curl -X POST http://localhost:9876/fleet/reload   # Reload all configs (same as SIGHUP)
curl http://localhost:9876/fleet/events       # SSE stream of lifecycle events
```

Each agent gets full PD coordination for free: registration, sessions, heartbeats, and salvage on crash. Supports `claude-cli`, `ollama`, `custom` (shell commands), and all `pd spawn` backends. Template variables (`{project}`) resolve from the YAML context. Fleet lifecycle events publish to the `fleet:events` channel for dashboard and menu bar subscriptions.

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
