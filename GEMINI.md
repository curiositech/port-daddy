# GEMINI.md - Port Daddy Project Context

## ⚓ Project Overview
**Port Daddy** is the authoritative "Agentic OS" control plane for local development. It is an orchestration daemon that provides system-level primitives to enable high-fidelity coordination between autonomous AI agents.

### Core Capabilities
- **Atomic Port Assignment**: Deterministic port mapping based on semantic identities (e.g., `myapp:api:main`).
- **Semantic Token Wildcards**: Pervasive pattern matching (`*`) across all coordination primitives (identities, skills, purposes, channels, file paths).
- **Swarm Radio (Pub/Sub)**: Real-time, low-latency signaling between agents using maritime signal flags. Supports pattern-based channel subscriptions.
- **Harbor Management**: Project-scoped isolation and resource mapping (via `.portdaddyrc`).
- **Distributed Locks**: Prevent agents from overlapping on shared resources. Supports pattern-based release.
- **Sessions & Notes**: Append-only audit trails. Queryable via project, agent, and purpose wildcards.
- **Agent Lifecycle (`pd spawn` & `pd watch`)**: Launch AI agents with built-in coordination and ambient triggers.
- **Agent Registry**: Heartbeat-based tracking with "Zombie" salvage. Supports filtering by skills and purpose patterns.
- **Local DNS**: Access services via `http://*.pd.local` instead of magic port numbers.

## 🕸️ Semantic Token Graph
Port Daddy treats coordination metadata as a graph of semantic tokens. Agents can query the system using wildcards to discover peers and resources:
- `pd agents --identity "myapp:*"`: Find all agents in a project.
- `pd agents --skills "*typescript*"`: Find agents with specific capabilities.
- `pd sessions --purpose "*bug*"`: Find all sessions related to bug fixing.
- `pd files --symbol "handle*"`: See who is currently working on specific code symbols.
- `pd msg "events:*"`: Subscribe to a broad category of swarm signals.

## 🏗️ Architecture
- **Daemon (`server.ts`)**: Express-based HTTP/SSE server running on `localhost:9876`.
- **CLI (`bin/port-daddy-cli.ts`)**: The primary interface for humans and agents. Aliased to `pd`.
- **Spawner (`lib/spawner.ts`)**: Backend-agnostic agent launcher (supports Aider, Claude-Engineer, etc.).
- **Watcher (`lib/watch.ts`)**: Ambient SSE subscriber for triggering commands on swarm events.
- **Persistence (`lib/db.ts`)**: SQLite-backed state storage in `port-registry.db`.
- **MCP Server (`mcp/server.ts`)**: Model Context Protocol integration for direct agent control.

## 🛠️ Building and Running
### Installation
```bash
npm install
npm run build
```

### Running the Daemon
```bash
npm run dev        # Development mode (auto-restarts)
npm start          # Production start (tsx server.ts)
pd start           # CLI command to start/background the daemon
```

### Agent Operations
```bash
pd spawn --backend ollama -- "Fix the login bug"    # Launch a coordinated agent
pd watch build-results --exec "./analyze.sh"        # Ambient response to swarm events
pd scan                                             # Detect frameworks and set up a Harbor
```

### Testing
```bash
npm test           # Full suite (unit + integration)
npm run typecheck  # Static type analysis
```

## 📜 Development Conventions
- **Language**: TypeScript (ESM).
- **Database**: `better-sqlite3`. Use `sqlite3 port-registry.db` for direct inspection.
- **Identities**: Always use `project:stack:context` format (e.g., `web:api:main`).
- **Maritime Theme**: Follow the local nomenclature (Harbor, Swarm, Salvage, Signal Flags).
- **Parity**: New features MUST be implemented across all surfaces: API, CLI, SDK, and Completions.
- **Testing Standard**: Every feature must have a corresponding test in `tests/unit/` or `tests/integration/`.

## 🤖 Agent Interaction (MCP)
Port Daddy provides a suite of tools for agents to coordinate:
- `begin_session`: Claim a work context and announce intent.
- `add_note`: Record progress or decisions (immutable).
- `claim_port`: Get a stable port for a service.
- `acquire_lock`: Mutex for shared resources.
- `pd_discover`: Discover additional tools (Webhooks, DNS, Tunnels).

## 🚑 Agent Salvage (Zombie Protocol)
If an agent crashes, Port Daddy marks it as a "zombie." Use `pd salvage` to view dead agents and `pd salvage claim <id>` to recover their context and notes.

## 🗂️ Key Directories
- `lib/`: Core logic (ports, sessions, locks, etc.)
- `routes/`: API endpoint definitions
- `bin/`: CLI implementation
- `tests/`: Extensive test suite (3,700+ tests)
- `docs/`: Design specs and SDK reference
