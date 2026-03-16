# ⚓ Port Daddy (v3.7.0)

<p align="center">
  <img src="https://raw.githubusercontent.com/curiositech/port-daddy/main/pd_logo.svg" alt="Port Daddy Logo" width="200">
</p>

<p align="center">
  <strong>The "Agentic OS" Control Plane.</strong><br />
  Authoritative port management, real-time swarm coordination, and immersive 3D visualization.
</p>

<p align="center">
  <a href="https://npmjs.com/package/port-daddy"><img src="https://img.shields.io/npm/v/port-daddy.svg?logo=npm&color=3AADAD" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-FSL--1.1--MIT-blue?color=3AADAD" alt="license"></a>
  <a href="https://github.com/curiositech/port-daddy"><img src="https://img.shields.io/badge/tests-3,700%2B%20passing-brightgreen?logo=jest&color=3AADAD" alt="tests"></a>
  <a href="https://github.com/curiositech/port-daddy/tree/main/skills/port-daddy-cli"><img src="https://img.shields.io/badge/AI%20Agents-40%2B%20compatible-blueviolet?logo=openai&color=3AADAD" alt="AI Agent Skill"></a>
  <a href="http://dashboard.pd.local:3144"><img src="https://img.shields.io/badge/Local--DNS-Active-success?logo=lighthouse&color=3AADAD" alt="Local DNS"></a>
</p>

---

## 🌊 Overview

**Port Daddy** is a lightweight, local orchestration daemon that transforms your development environment into a high-fidelity control plane for autonomous AI agents. 

While individual agents are brilliant, **coordination** is the bottleneck. Port Daddy solves this by providing the missing system-level primitives: **Atomic Port Assignment**, **Real-time Pub/Sub Messaging**, **Distributed Locks**, and **Append-only Session Trails**. 

Whether you are running a 15-service monorepo or a swarm of 50 agents attacking a complex bug, Port Daddy ensures your local harbor is organized, observable, and purring.

### ⚓ Key Primitives
- **Atomic Port Assignment:** Zero race conditions. Semantic identities (e.g., `myapp:api`) map to stable, deterministic ports.
- **Swarm Radio (Pub/Sub):** Low-latency, SSE-backed messaging for inter-agent signaling using **Maritime Signal Flags**.
- **Agentic Control Plane:** A live 2D/3D dashboard (`*.pd.local`) to visualize active agents, service health, and message traffic.
- **Automatic Salvage:** Captures session state and notes from "zombie" agents that crash mid-task, allowing others to recover their work.
- **Local DNS Resolver:** Access your services at `http://api.pd.local` instead of magic port numbers.

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
brew tap erichowens/port-daddy
brew install port-daddy

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
- **Spawn:** `pd spawn` launch AI agents (Claude, Aider) with coordination baked in.
- **Phases:** Track work via `planning`, `testing`, and `reviewing` session phases.

### Agent Inboxes (SSE Watch)
Every agent (or human) can stream their personal inbox live:
```bash
# Stream your inbox in real-time
pd inbox watch --agent CAPTAIN

# Send a DM to the captain
pd inbox send CAPTAIN "Course corrected. Heading 270." --sender "PILOT"
```

### Distributed Locks
Prevent agents from "stepping on" each other's files or DB migrations:
```bash
pd with-lock db-migrations -- npm run migrate
```

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
git clone https://github.com/erichowens/port-daddy
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
- **Issues:** [GitHub Issue Tracker](https://github.com/erichowens/port-daddy/issues)
- **Help:** Run `pd help` or `pd learn` for the interactive tutorial.
- **Vibe:** Ambitious, CUTE and CHARMING. 🚩
