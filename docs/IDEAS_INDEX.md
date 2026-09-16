# Port Daddy Idea Index (April 2026)

Canonical note: this index is now historical context. The active organized trove lives in `docs/recovery/IDEAS-TROVE.md`, which explicitly preserves Spark, Spider, and cartographer inputs.

This document is the **Comprehensive Index of All Emergent Ideas** for Port Daddy. It maps out the expansive universe of concepts generated during V4 planning, detailing what each idea is, where its primary text lives, and a firm recommendation on when (or if) it should be built.

---

## 1. Fleet, Always-On Agents & Suggestibility

The Fleet system represents Port Daddy's evolution from a passive orchestrator into an active, background-running "Agentic OS."

### 1.1. Fleet Configuration & Seamless Background Agents
*   **What it is:** Declarative, always-on agent swarms configured via `pd-fleet.yml`. Agents can be scheduled (cron) or triggered by ambient events (`git:committed`, `file:saved`, `build:error`, `test:result`). The engine supports auto-respawning crashed agents and enforcing singleton execution.
*   **Primary Location:** `V4-UNIFIED-ROADMAP.md` (Phase 3A), `drifting-crunching-aurora.md` (Phase 4).
*   **Recommendation: Shipped & Expanding.** The core engine and templates are live. The immediate next step is building out the `file:saved`, `build:error`, and `test:result` event sources to make agents truly reactive to the local environment, then adding declarative primitives like `trigger: webhook:<event>` and `trigger: files:<glob>` so projects can define richer local event topologies without custom glue.

### 1.2. The Suggestibility Layer & FleetBar App
*   **What it is:** A native macOS menu bar app (FleetBar, built in SwiftUI) that monitors daemon SSE streams. Instead of just showing status dots, FleetBar acts as a "Suggestion Presenter." When background agents find issues (e.g., QA agent finds a null reference, Spark agent generates an idea), they publish "suggestions" that appear in the menu bar with actionable buttons (e.g., `[Fix]`, `[Read]`). A Tauri version is planned for Windows/Linux.
*   **Primary Location:** `drifting-crunching-aurora.md` (Phase 5 & 6).
*   **Recommendation: Active Development.** The FleetBar UI shell is built. Wiring up the daemon's `GET /fleet/suggestions` route and the actionable buttons is the next critical UX milestone.

### 1.3. Agent Memory Compression
*   **What it is:** A background process that detects when an agent's episodic memory (session notes) exceeds a threshold and automatically summarizes it into procedural memory, preventing unbounded context window growth.
*   **Primary Location:** `PLAN.md` (Appendix A11), `v4_thoughts.md`.
*   **Recommendation: Immediate.** As fleets run continuously, their append-only session logs will quickly exhaust token limits without compression.

---

## 2. Infrastructure, Resilience & Performance (The Engine Room)

V4 replaces the prototype architecture with an enterprise-grade kernel capable of handling thousands of requests per second from high-frequency agents.

### 2.1. Bun Migration & Fastify
*   **What it is:** Porting the daemon from Express/Node to Fastify/Bun. Fastify has already shipped, significantly reducing HTTP overhead. The final step is compiling the daemon to a single-file binary via `bun build --compile` for zero-dependency distribution.
*   **Primary Location:** `V4-UNIFIED-ROADMAP.md` (Phase 4A).
*   **Recommendation: High Priority.** This solves the "Node.js version mismatch" friction for end users.

### 2.2. SQLite WAL & Socket-Level Backpressure
*   **What it is:** Running SQLite in Write-Ahead Log (WAL) mode with `PASSIVE` checkpoints to allow high-concurrency reads and writes from multiple agents. To prevent the daemon's RAM from bloating during heavy write spikes, socket-level backpressure pauses IPC client streams when SQLite WAL commits lag.
*   **Primary Location:** `PLAN.md` (Part XXVIII), `V4-MASTER-PLAN.md`, `server.ts`.
*   **Recommendation: Partially Shipped.** IPC write-queue backpressure is active. Perfecting the SQLite WAL truncation and HTTP-level backpressure is the final mile for daemon resilience.

### 2.3. The Worktree Reaper
*   **What it is:** A garbage collection routine that monitors session status. When an agent's session is marked `completed` or `abandoned`, the reaper automatically runs `git worktree remove --force <path>` to clean up the isolated environment.
*   **Primary Location:** `PLAN.md` (Appendix A5), `STIGMERGIC_BACKLOG.md`.
*   **Recommendation: Immediate.** Worktree isolation is standard now. Without a reaper, SSDs will fill up rapidly with dead agent branches.

---

## 3. Distribution & Ecosystem

Making Port Daddy accessible, discoverable, and universal.

### 3.1. Homebrew Distribution & Universal Install
*   **What it is:** The "2-command install": `brew install curiositech/tap/port-daddy && pd mcp install`. This relies on pre-compiled `better-sqlite3` native bindings to avoid Python/C++ build errors on the user's machine, and a Ruby Cask to distribute the FleetBar app.
*   **Primary Location:** `drifting-crunching-aurora.md` (Phase 1 & 2).
*   **Recommendation: Top Priority.** The `pd mcp install` command is built. Creating the Homebrew formula is the single biggest growth lever right now.

### 3.2. A2A Protocol Support
*   **What it is:** Exposing Port Daddy agents via the Google A2A protocol, allowing them to discover and be discovered by non-Port Daddy AI agents in the industry.
*   **Primary Location:** `PLAN.md` (Appendix A15), `v4_thoughts.md`.
*   **Recommendation: Deferred indefinitely.** Wait to see if A2A actually becomes an industry standard before investing integration effort.

---

## 4. The Semantic Graph & Stigmergy (The Nervous System)

Treating codebase artifacts, agent claims, and capabilities as nodes in a graph, allowing for passive coordination (stigmergy) rather than explicit messaging.

### 4.1. Graph-Centric `pd watch`
*   **What it is:** Upgrading the current channel-centric `pd watch` to accept semantic graph nodes. Instead of watching `git:committed`, an agent watches `symbol:processPayment:*` and wakes up if *any* agent modifies, claims, or relates to that specific code symbol.
*   **Primary Location:** `PLAN.md` (Appendix A8), `semantic-token-graph.md`.
*   **Recommendation: Phase 1.** This is the killer feature of the Semantic Graph. Build this the moment the Unified Edge Table is merged.

### 4.2. Stigmergic Merging (The Janitor Agent)
*   **What it is:** A daemon-level agent that watches the graph of "confidence pheromones." When a file hits a 0.95 confidence threshold (because a Coder, Reviewer, and Tester have all "sprayed" positive annotations on it), the Janitor automatically orchestrates a `git merge` of the involved worktrees.
*   **Primary Location:** `PLAN.md` (Appendix A3), `WORKTREE_SWARMS.md`.
*   **Recommendation: Deferred (Phase 4.x).** Brilliant but dangerous. Auto-merging requires the Semantic Edge Table to be completely bulletproof first.

### 4.3. Semantic Synonym Registry
*   **What it is:** A lightweight local LLM embedding step (via Ollama) that normalizes semantic tokens on the fly, preventing the graph from fracturing because one agent claimed `javascript` and another claimed `js`.
*   **Primary Location:** `PLAN.md` (Appendix A7), `semantic-token-graph.md`.
*   **Recommendation: Phase 1.** Necessary for the Semantic Graph to be accurate, but can be built as a delayed background job.

---

## 5. The Anchor Protocol & Economy (The Formal Contracts)

Shifting Port Daddy from a local orchestrator to a cryptographic contract enforcer, where agents put "credits" on the line.

### 5.1. Harbor Resource Inheritance & Hive Mind
*   **What it is:** When an agent enters a Harbor (e.g., `myapp`), it automatically inherits capabilities (like `skill:postgres`) and gains access to a Harbor-scoped embedding store (the Hive Mind) where all facts discovered by previous agents are stored.
*   **Primary Location:** `PLAN.md` (Appendix A9/A10), `V4-HARBOR-ECONOMY.md`.
*   **Recommendation: Phase 2.** Essential for making teams of agents feel like a cohesive unit rather than amnesiac individuals.

### 5.2. The Independent Arbiter
*   **What it is:** Extracting the Arbiter (the rule enforcer) out of the Port Daddy daemon into its own standalone binary (`pd arbiter start`). This prevents a compromised daemon from covering its tracks in peer-to-peer (P2P) remote harbor setups.
*   **Primary Location:** `PLAN.md` (Appendix A6), `ARBITER_DESIGN.md`.
*   **Recommendation: Deferred (Phase 5).** Unnecessary for local orchestration. Only required when cross-machine trust federation (Lighthouses) is implemented.

### 5.3. The Jury-rig Bridge
*   **What it is:** A connector that maps Jury-rig abstract node executions to Port Daddy physical Harbors. If a Jury-rig evaluation fails, Port Daddy's Arbiter revokes the Harbor Card, shutting down the agent's filesystem and port access instantly.
*   **Primary Location:** `PLAN.md` (Appendix A4), `STIGMERGIC_BACKLOG.md`.
*   **Recommendation: Phase 3.** Highly valuable for enterprise/power users who want deterministic DAG workflows with zero-trust execution.
