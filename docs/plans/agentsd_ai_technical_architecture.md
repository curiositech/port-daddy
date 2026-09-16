# Technical Architecture Document (TAD)

**Project:** `agentsd.ai` (The Reactive Coordination Kernel)

**Architect:** Erich Owens

**Date:** April 2026

**Version:** 3.0 (Production Blueprint)

------

## 1. Executive Summary

This document outlines the technical architecture for `agentsd.ai`, a high-performance, formally verified layer-zero control plane for autonomous agent teams. Operating as a Reactive Coordination Kernel, it provides the cryptographic physics and semantic primitives required for distributed, multi-agent workflows to execute safely on local hardware.

The architecture strictly decouples system permissions (the control plane) from AI execution (the data plane). Rather than relying on rigid, top-down orchestration pipelines (like directed acyclic graphs), the kernel provisions a rich "shared medium" of coordination primitives—semantic routing, tuple spaces, distributed graph memory, and stigmergic traces. It bridges organic swarm behavior with strict engineering guarantees by forcing all agent interactions through a rigorous transactional boundary, mathematically preventing rogue behaviors and ensuring local-first fault tolerance.

## 2. Core Architectural Principles

- **Zero-Trust Localhost:** Local execution environments are treated as hostile. Agents must prove their identity and capabilities cryptographically before accessing shared host resources or cross-agent channels.
- **Math-Based Security:** Trust relies entirely on cryptographic primitives (Ed25519 signatures, Merkle Proofs) rather than application-layer logic or "hope-based" sandboxing.
- **Local-First Resilience:** Intra-node orchestration, capability verification, and state persistence operate entirely offline, immune to cloud latency or outages.
- **Deterministic Physics, Adaptive Coordination:** The kernel strictly enforces state monotonicity and invariant bounds, but provides un-opinionated coordination primitives allowing agent swarms to dynamically determine their execution topology.
- **Ephemeral Actors, Persistent State:** Agents are treated as disposable compute units. Their execution state is highly persistent, context-compressed, and end-to-end encrypted.

## 3. Component Architecture & Tech Stack

The core infrastructure operates as a high-throughput daemon running on the host OS, orchestrating ephemeral agent processes.

- **Runtime & Transport:** Built on Bun and TypeScript, leveraging Fastify (HTTP/TCP) and hardened Unix Domain Sockets (UDS/Named Pipes) for Inter-Process Communication (IPC).
- **Throughput Target:** Engineered to handle 20,000+ local agent requests per second, with sub-300-microsecond pub/sub signal resolution.
- **Cryptographic Core:** A Rust FFI layer (`harbor-card-rs`) compiled to a C dynamic library handles memory-safe JWT validation, Ed25519 signature checks, and multi-hop capability attenuation without blocking the main event loop.
- **State & Memory:** `bun:sqlite` provides the singular source of truth, utilizing the JSON1 extension to power high-velocity in-memory tuple spaces and disk-backed write-ahead logs.

## 4. Identity & The Anchor Protocol (Delegated PKI)

Agents are constrained by the Anchor Protocol, a verifiable economy of capabilities. The system employs a Delegated Public Key Infrastructure to separate local and remote trust validation.

1. **Master Identity:** The human operator authenticates via OIDC on the central web dashboard, establishing a Master Profile.
2. **Local Infrastructure Keys:** The daemon generates an ephemeral Ed25519 keypair ($sk_{local}, pk_{local}$) persisted locally.
3. **Attestation Certificates:** The local daemon registers $pk_{local}$ centrally to receive a signed Attestation proving authorization.
4. **Intra-Node Trust (Local-First):** Local agents use capability JWTs (Harbor Cards) verified strictly by the local $sk_{local}$ signature. No central attestation or internet connection is required.
5. **Inter-Node Trust:** For remote execution, the daemon attaches the Attestation Certificate to the Harbor Card, establishing transitive trust across a flat mesh network (e.g., Tailscale).
6. **Delegated Attenuation:** When an agent spawns a sub-agent, it uses offline attenuation to mint a child Harbor Card, mathematically restricting the child's capabilities to a strict subset of its own, signing it locally to avoid central daemon latency.

## 5. The Shared Medium (Coordination Primitives)

The architecture provides a complex adaptive execution environment where agents coordinate concurrently through multiple intersecting systems.

### 5.1 Semantic Routing & Pub/Sub Channels

Agents do not communicate over hardcoded IP/ports. Every entity registers a semantic identity (`project:stack:context`).

- **Radix Trie Discovery:** An adaptive Radix Trie structure enables $O(k)$ wildcard resolution (e.g., `*:frontend:*`).
- **Maritime Channels:** High-frequency IPC pub/sub utilizes categorized nautical channels (e.g., `bridge:myapp:helm`, `watch:auth.ts:edits`) for state broadcasting.
- **Direct Inbox:** For explicit Agent-to-Agent (A2A) handoffs, a secure SQLite-backed inbox routes direct messages, preventing channel flooding.

### 5.2 The Tuple Space (Linda Architecture)

The Harbor hosts a central, associative memory pool for decoupled task allocation.

- Agents deposit structured JSON tuples (e.g., `{"intent":"refactor", "target":"auth.ts", "urgency":0.9}`).
- Unrelated worker agents continuously watch the space via pattern matching, lock the tuple, execute the work, and deposit a result tuple.

### 5.3 Stigmergic Coordination (Pheromones)

Agents coordinate indirectly through environmental traces rather than direct messaging.

- Agents drop metadata tags ("pheromones") on the Abstract Syntax Tree (AST) or file system representation.
- These pheromones possess gradients and explicit evaporation rates. High-contention or error-dense files glow "red hot," drawing idle agents to follow the gradient to the problem area.

### 5.4 Distributed Graph Memory

The environment acts as a shared, reactive graph.

- Tree-sitter extracts AST symbols into `graph_edges`.
- Agents formulate hypotheses and pin them to the graph as nodes. Validator agents subscribe to graph changes, run tests, and attach result child nodes.

## 6. Transaction Guarantees & Active Revocation

To bridge the gap between organic swarm behavior and strict engineering safety, the system enforces a transactional boundary around all agent actions.

### 6.1 Stigmergic Locking

When an agent decides to modify a file based on a pheromone gradient, it cannot write directly. It must write an "intent tuple" to the Tuple Space. The kernel then grants an exclusive, cryptographically backed, time-bound lock on that specific AST node or file.

### 6.2 The Escrow Pattern (Ephemeral Worktrees)

Agents execute their tasks in isolated, ephemeral git worktrees. Upon completion, they do not push to the main branch; they submit a proposed patch to a centralized Merge Queue.

### 6.3 The Arbiter (Invariant Enforcement)

Before the macro-system accepts any transaction from the Merge Queue, a deterministic ambient security monitor (The Arbiter) checks system invariants.

- It verifies that the code compiles, tests pass, and that AST dependencies mapped in the Symbol Index are not violated.
- It continuously monitors the activity log for runtime violations such as `PID_SQUATTING`, `CAP_ESCALATION` (verified via the Rust FFI), and `NOTE_MONOTONICITY`.
- If a transaction fails inspection, it is rolled back, and the agent receives the error log to attempt a new approach.

### 6.4 Graph-Aware Rollbacks & Context Compression

To prevent deterministic doom-loops (where a rehydrated agent repeats the exact same catastrophic error):

- If an agent fails repeatedly at the same sequence number, the Arbiter initiates a Graph-Aware Rollback.
- The successor agent receives an Escalation Frame detailing the prior failure. Context is compressed: the agent receives full JSON traces of immediate preceding nodes, while older nodes are semantically summarized by the control plane.

### 6.5 Deterministic Revocation (The Kill Switch)

- **Cuckoo Filters:** A compressed global filter of revoked nonces is pushed to daemons. A positive hit pauses execution to query a definitive Merkle Proof.
- **Active Termination:** The Arbiter maintains a live WebSocket/SSE connection to the central server. If an active session token is revoked, the Arbiter immediately issues a `SIGKILL` to the agent's OS process.

## 7. Interface Aesthetics & Human Interaction

The UI serves as an observability terrarium and multiplayer collaboration space, making the transaction guarantees visible and interactive.

### 7.1 Visual Paradigm (Swiss Modern / Win 3.1)

The interface strictly adheres to a pure Windows 3.1 and Neobrutalist visual paradigm. It utilizes classic MS Sans Serif typography, heavy gray dialog boxes, stark white/black beveled borders, and a Multiple Document Interface (MDI). It explicitly rejects modern web ornamentation in favor of unyielding functional utility.

### 7.2 The Topographic Canvas & Telemetry

- The dashboard visualizes the codebase's Abstract Syntax Tree geographically. Pheromone gradients and active file claims are rendered as real-time heatmaps over the file structure.
- When an agent claims a file via stigmergic locking, a status indicator displays real-time presence (e.g., `Agent-73 [LOCK: auth.ts]`).

### 7.3 Cooperative Vibe Coding (The Interrupt Mechanic)

The human operator is treated as a highly-privileged actor within the shared medium.

- **Host Authority:** In collaborative sessions, the Host Daemon is strictly authoritative. Guest Daemons receive heavily circumscribed Harbor Cards (e.g., `["file:read:workspace", "vibe:propose_edit"]`), allowing them to submit diff proposals but not overwrite files directly.
- **Human Override:** If the human observes the swarm drifting down an incorrect path, they do not type a traditional chat prompt. They drop a high-priority tuple directly onto the board (e.g., `{"intent":"human_override", "target":"auth.ts", "directive":"use_jwt_instead"}`). The agents instantly read the new state gradient, drop their current context, and pivot their active inference toward the human's directive.

## 8. Implementation Phasing

### Phase 1: The Agnostic Base Mesh & Physics

- Finalize local Rust FFI for capability subset checks and cryptography.
- Establish Fastify/UDS transport, Semantic Radix Trie routing, and the SQLite backing store.
- Implement E2EE Swarm Key escrow protocol.

### Phase 2: Transaction Guarantees

- Deploy Ephemeral Worktrees and the Merge Queue.
- Implement the Arbiter and the core invariants (`CAP_ESCALATION`, `PID_SQUATTING`).
- Implement the Active `SIGKILL` revocation subscription.

### Phase 3: Stigmergy & Coordination

- Deploy Tuple Spaces and Pheromone evaporation engines within the SQLite JSON1 extension.
- Implement Graph-Aware Rollbacks and context compression logic.

### Phase 4: Observability & Multiplayer Canvas

- Launch the brutalist web dashboard and spatial Topographic AST view.
- Implement the "Human Override" tuple injection mechanic and Guest Daemon capability attenuation for cooperative coding.