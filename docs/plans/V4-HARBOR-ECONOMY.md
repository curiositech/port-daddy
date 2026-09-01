# Plan: Port Daddy V4 — The Harbor Economy & Reactive Kernel

## 🧠 1. The Reactive Coordination Kernel
To support high-frequency swarms and real-time graph lookups, the V4 Daemon is re-architected as a high-performance kernel.

### A. Transport & Stack
- **Runtime**: **Bun** (for ultra-low latency, native SQLite, and single-file binary compilation).
- **Web Framework**: **Fastify** (replacing Express for higher throughput).
- **IPC Transport**: **Unix Domain Sockets (UDS)** on Unix, **Named Pipes** on Windows, using **MessagePack/CBOR** for fast binary serialization of heavy heartbeats.
- **Persistence**: **SQLite with WAL** (Write-Ahead Logging) to allow concurrent reads during high-frequency writes.

### B. In-Memory Semantic Trie & Graph
- **The Graph**: Relationships aren't just columns; they are edges (`source -> relation -> target`).
- **The Trie**: An in-memory Prefix Tree (Trie) indexes all active semantic tokens (project:stack:context, skills, file paths). 
- **Lookup**: When an agent queries `myapp:*:web`, the Trie resolves it in sub-milliseconds without hitting SQLite. SQLite acts purely as the persistence/recovery layer.

### C. Swarm Radio (Memory-Mapped Pub/Sub)
- **High-Frequency**: Move from HTTP/SSE overhead to a Memory-Mapped Message Bus for local agents, drastically reducing latency for high-frequency coordinate signals.

## ⚓ 2. The Unified Harbor Model
Every project defaults to an implicit Harbor. A Harbor is a cryptographic namespace, a graph projection, and an ambient knowledge pool.

### A. Default Harbors & Inheritance
- **Trigger**: `pd begin` or `pd scan` auto-creates a harbor (e.g., `myapp`).
- **Scope**: `myapp:*`.
- **Harbor Inheritance (Ambient Knowledge)**: Harbors are nodes in the semantic graph. If a harbor provides `skill:postgres`, all agents inside automatically inherit that edge.
- **Security**: Enforced via **Harbor Tokens** (JWTs signed with ed25519). All requests must present a token.

### B. Lighthouses (Discovery & Federation)
- **Concept**: A daemon advertising its harbors.
- **Discovery Layers**:
  1. **Layer 1 (Local)**: mDNS/Bonjour for zero-config tandem coding.
  2. **Layer 2 (Relay)**: `lighthouse.portdaddy.dev` for remote teams.
  3. **Layer 3 (Public)**: Marketplace for GPU compute and specialist agent bidding.

## 🕸️ 3. The Semantic Token Graph
Agents navigate their environment through high-fidelity relationships.

### A. Unified Edge Table
```sql
CREATE TABLE graph_edges (
  source_id  TEXT NOT NULL, -- Format: 'type:id' (e.g., 'agent:cli-123')
  relation   TEXT NOT NULL, -- 'claims', 'knows', 'calls', 'contains'
  target_id  TEXT NOT NULL, -- Format: 'type:id' (e.g., 'symbol:handleLogin')
  metadata   TEXT,
  PRIMARY KEY (source_id, relation, target_id)
);
```

### B. Lazy Code Promotion & Autonomous Architects
- **Code Decomp**: We avoid DB bloat via **Lazy Promotion**. The codebase is summarized, but a specific function (`symbol:authCheck`) is only promoted to a Graph Token when an agent explicitly interacts with it.
- **Autonomous Architects**: Agents can declare new relationships (`POST /graph/declare`). To prevent hallucinated noise, these declarations carry a "Confidence Score" and tie into the agent's reputation.

### C. Visualizers & TUI
- **Dashboard Graph View**: A real-time, force-directed graph showing the swarm's activity, with "heat maps" for highly-contested files or symbols.
- **Semantic TUI**: `pd agents` and `pd sessions` show Relationship Previews (e.g., `cli-123 knows(ts) claims(auth.ts)`).

## ⚖️ 4. The Anchor Protocol (Agent Economy)
Work is no longer "started and hoped for"; it is **Anchored**.

### A. The Transaction Lifecycle
1. **File Float Plan**: Requester declares task + acceptance criteria + credits.
2. **Bidding**: Agents (local/remote) bid based on reputation/XP.
3. **Escrow**: Daemon signs the Anchor and holds credits.
4. **Settlement**: Evaluator scores work; credits/XP are released.

### B. Anchor Data Schema
```sql
CREATE TABLE anchors (
  id TEXT PRIMARY KEY,
  harbor_id TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  worker_id TEXT,
  plan_hash TEXT NOT NULL,
  credit_amount INTEGER,
  escrow_status TEXT,
  status TEXT,
  daemon_sig TEXT,
  FOREIGN KEY (harbor_id) REFERENCES harbors(id)
);
```

## 🤖 5. PD Fleet & Memory
### A. Declarative Swarms (`fleet.yaml`)
- **Config**: `.portdaddy/fleet.yaml` defines always-on agents, their triggers (`pd watch`), and memory scopes. Managed by `pd fleet up/down`.

### B. Memory & Life Integration (The Personal OS)
- **Episodic Memory**: Agent memory persists across sessions, scoped by wildcard identities.
- **Hive Mind**: Harbor-scoped collective memory (facts + semantic embeddings).
- **Connectors**: Read-only connectors (Gmail, GCal) with an **Outbound Firewall** requiring human approval via the Dashboard for writes.

## 🛡️ 6. Robustness & Security (V4 Build)
### A. Layered Resurrection
1. **Layer 1**: OS-level (launchd/systemd).
2. **Layer 2 (The Bosun)**: Tiny sidecar process monitoring a `~/.port-daddy/heartbeat` file. Kills/restarts stale daemon.
3. **Layer 3**: Semantic Trie and state reconstruction from SQLite WAL on boot.

### B. Build Integrity
- **Distribution**: Single compiled binary via `bun build --compile`.
- **Signing**: Sign releases with Sigstore/cosign; generate SBOMs.

## 🗺️ 7. Implementation Phases
1. **Phase 0 (Foundation)**: Bun migration, UDS/Named Pipes IPC, Semantic Trie + SQLite WAL.
2. **Phase 1 (The Graph)**: Unified Edge Table, Harbor Inheritance, Dashboard Graph Visualizer.
3. **Phase 2 (The Economy)**: Anchor Protocol, Float Plans, Escrow Ledger.
4. **Phase 3 (The Fleet)**: `fleet.yaml`, Episodic Memory, Connectors.
5. **Phase 4 (The Network)**: Lighthouses, mDNS, Relay Federation.
