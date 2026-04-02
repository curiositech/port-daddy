# Port Daddy Idea Index (April 2026)

This document is the **Comprehensive Index of All Emergent Ideas** for Port Daddy. It maps out the expansive universe of concepts generated during V4 planning, detailing what each idea is, where its primary text lives, and a firm recommendation on when (or if) it should be built.

---

## 1. The Semantic Graph & Stigmergy (The Nervous System)

These ideas revolve around treating codebase artifacts, agent claims, and capabilities as nodes in a graph, allowing for passive coordination (stigmergy) rather than explicit messaging.

### 1.1. Stigmergic Merging (The Janitor Agent)
*   **What it is:** A daemon-level agent that watches the graph of "confidence pheromones." When a file hits a 0.95 confidence threshold (because a Coder, Reviewer, and Tester have all "sprayed" positive annotations on it), the Janitor automatically orchestrates a `git merge` of the involved worktrees.
*   **Primary Location:** `PLAN.md` (Appendix A3), `WORKTREE_SWARMS.md`.
*   **Recommendation: Deferred (Phase 4.x).** Brilliant but dangerous. Auto-merging requires the Semantic Edge Table (Phase 1) to be completely bulletproof first.

### 1.2. The Worktree Reaper
*   **What it is:** A garbage collection routine that monitors session status. When an agent's session is marked `completed` or `abandoned`, the reaper automatically runs `git worktree remove --force <path>` to clean up the isolated environment.
*   **Primary Location:** `PLAN.md` (Appendix A5), `STIGMERGIC_BACKLOG.md`.
*   **Recommendation: Immediate (Next sprint).** Worktree isolation is standard now. Without a reaper, SSDs will fill up rapidly with dead agent branches.

### 1.3. Graph-Centric `pd watch`
*   **What it is:** Upgrading the current channel-centric `pd watch` to accept semantic graph nodes. Instead of watching `git:committed`, an agent watches `symbol:processPayment:*` and wakes up if *any* agent modifies, claims, or relates to that specific code symbol.
*   **Primary Location:** `PLAN.md` (Appendix A8), `semantic-token-graph.md`.
*   **Recommendation: Phase 1.** This is the killer feature of the Semantic Graph. Build this the moment the Unified Edge Table is merged.

---

## 2. The Anchor Protocol & Economy (The Formal Contracts)

These ideas shift Port Daddy from a local orchestrator to a cryptographic contract enforcer, where agents put "credits" on the line to perform work.

### 2.1. Harbor Resource Inheritance & Hive Mind
*   **What it is:** When an agent enters a Harbor (e.g., `myapp`), it automatically inherits capabilities (like `skill:postgres`) and gains access to a Harbor-scoped embedding store (the Hive Mind) where all facts discovered by previous agents are stored.
*   **Primary Location:** `PLAN.md` (Appendix A9/A10), `V4-HARBOR-ECONOMY.md`.
*   **Recommendation: Phase 2.** Essential for making teams of agents feel like a cohesive unit rather than amnesiac individuals.

### 2.2. The Independent Arbiter
*   **What it is:** Extracting the Arbiter (the rule enforcer) out of the Port Daddy daemon into its own standalone binary (`pd arbiter start`). This prevents a compromised daemon from covering its tracks in peer-to-peer (P2P) remote harbor setups.
*   **Primary Location:** `PLAN.md` (Appendix A6), `ARBITER_DESIGN.md`.
*   **Recommendation: Deferred (Phase 5).** Unnecessary for local orchestration. Only required when cross-machine trust federation (Lighthouses) is implemented.

---

## 3. Infrastructure, Platform & Network

These ideas scale Port Daddy from a local tool to a networked ecosystem.

### 3.1. The WinDAGs Bridge
*   **What it is:** A connector that maps WinDAGs abstract node executions to Port Daddy physical Harbors. If a WinDAGs evaluation fails, Port Daddy's Arbiter revokes the Harbor Card, shutting down the agent's filesystem and port access instantly.
*   **Primary Location:** `PLAN.md` (Appendix A4), `STIGMERGIC_BACKLOG.md`.
*   **Recommendation: Phase 3.** Highly valuable for enterprise/power users who want deterministic DAG workflows with zero-trust execution.

### 3.2. A2A Protocol Support
*   **What it is:** Exposing Port Daddy agents via the Google A2A protocol, allowing them to discover and be discovered by non-Port Daddy AI agents in the industry.
*   **Primary Location:** `PLAN.md` (Appendix A15), `v4_thoughts.md`.
*   **Recommendation: Deferred indefinitely.** Wait to see if A2A actually becomes an industry standard before investing integration effort.

### 3.3. Semantic Synonym Registry
*   **What it is:** A lightweight local LLM embedding step (via Ollama) that normalizes semantic tokens on the fly, preventing the graph from fracturing because one agent claimed `javascript` and another claimed `js`.
*   **Primary Location:** `PLAN.md` (Appendix A7), `semantic-token-graph.md`.
*   **Recommendation: Phase 1.** Necessary for the Semantic Graph to be accurate, but can be built as a delayed background job rather than in the hot path.

### 3.4. Agent Memory Compression
*   **What it is:** A background process that detects when an agent's episodic memory (session notes) exceeds a threshold and automatically summarizes it into procedural memory, preventing unbounded token growth.
*   **Primary Location:** `PLAN.md` (Appendix A11), `v4_thoughts.md`.
*   **Recommendation: Immediate.** The current append-only session notes will eventually break agent context windows.

---

## 4. Execution Strategy & Next Steps

Based on the index above, here is the immediate operational plan:

1.  **Land the Planes:** Merge all open security and documentation worktrees into `main`. The product must be secure and the website must be honest.
2.  **Win the Distribution War:** Finalize the Homebrew Tap (`brew install curiositech/tap/port-daddy`) and the `pd mcp install` flow.
3.  **Clean up the Stubs:** Either wire the existing Semantic Graph stubs (`lib/symbol-index.ts`, `lib/merge-queue.ts`) into the SQLite database, or branch them out of `main`.
4.  **Execute the Worktree Reaper and Memory Compression:** Implement these two immediately to prevent local environments from choking on their own data.
