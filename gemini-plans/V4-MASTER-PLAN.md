# Port Daddy V4: The Harbor Economy & Reactive Kernel (Master Plan)

## ⚓ 1. Vision: The Operating System for Agent Teams
Port Daddy V4 transitions from a local port manager to a high-performance **Reactive Coordination Kernel**. It provides the economic and cryptographic primitives required for trustless, distributed agent collaboration.

---

## 🧠 2. Technical Invariants (The "Deep Engineering")

### A. The Reactive Kernel (Bun/Fastify/IPC)
*   **Throughput Invariant:** The kernel must handle 20,000+ local agent requests per second via IPC.
*   **Latency Invariant:** A pub/sub signal from Agent A to Agent B (including Trie resolution and UDS roundtrip) must complete in **<300 microseconds**.
*   **Two-Tier Scheduler:**
    *   **Tier 1 (Synchronous):** Anchor state changes, heartbeats, and locks.
    *   **Tier 2 (Batched):** Logs, dashboard SSE updates, and telemetry.
*   **Socket-Level Backpressure:** If SQLite WAL commits lag, the kernel exerts backpressure at the UDS/Named Pipe level, forcing agents to pause rather than bloating daemon RAM.

### B. The Anchor Protocol (Verifiable Economy)
*   **Escrow Handshake:**
    1.  **Requester:** signs `FloatPlan` (ed25519).
    2.  **Daemon:** validates balance, initiates SQLite `BEGIN EXCLUSIVE` transaction, locks credits, hashes plan, signs with `DaemonKey`.
    3.  **Worker:** verifies `DaemonKey` signature, begins work.
*   **Evidence Chain:** 
    *   Session notes are stored as a **Hash Chain**. Note $N$ includes `SHA256(Note N-1)`.
    *   Final settlement includes the **Merkle Root** of all artifacts produced.
*   **Bilateral Receipts:** Settlement results in a signed JSON object stored in the agent's local "Wallet." This allows Harbor reconstruction from agent evidence if the central DB is lost.

### C. The Radix Trie (Semantic Discovery)
*   **Structure:** Adaptive Radix Tree (ART) to collapse common prefixes (e.g., `myapp:production:v4:`).
*   **Harbor Bitmasks:** Each Harbor is assigned a 64-bit mask. Trie nodes store a cumulative mask of descendants. Wildcard queries use bitwise AND to skip branches not containing the target Harbor's tokens.
*   **Lazy Promotion:** Static symbols are promoted to graph nodes only after an agent interacts with them, preventing "Codebase Bloat."

### D. Hardened Windows IPC
*   **Security Descriptors:** Named Pipes are created with explicit **DACLs** using SDDL: `D:(A;;GA;;;OW)(A;;GA;;;SY)(A;;GA;;;BA)`.
*   **Impersonation Prevention:** Pipes are configured with `PIPE_REJECT_REMOTE_CLIENTS` to prevent NTLM relay attacks.

---

## 🖼️ 3. Wireframes (Visual Design)

### Dashboard: The Lighthouse Browser
```text
 🔦 LIGHTHOUSE REGISTRY           [Search capabilities...]  [⟳] 
 ───────────────────────────────────────────────────────────────
 LOCAL NETWORK (mDNS)
 🟢 alice-macbook (192.168.1.42)
    └ harbor: myapp (3 agents, 1200 credits)      [Request Join]

 RELAY (lighthouse.portdaddy.dev)
 🟡 cluster-alpha (Remote GPU Compute)
    └ harbor: llama-70b-pool ($0.02/min)          [Request Join]
 
 PUBLIC MARKETPLACE (Open Bids)
 📋 "Fix: Auth race condition in Vite" — 500 cr
    Posted by: acme-inc · 3 bids pending          [Review Bids]
```

### Dashboard: The Swarm Graph (Hive Mind)
```text
 🕸️ SEMANTIC GRAPH (myapp:**)                     [Force Directed]
 ───────────────────────────────────────────────────────────────
 [Agent: coder-01] ───(claims)───> [File: auth.ts]
        │
   (recalls)
        ▼
 [Memory: "JWT check"] <──(merkle)── [Receipt: anch_7f3k]
                                          │
                                     (payout to)
                                          ▼
                                   [Wallet: coder-01]
```

---

## 🧪 4. Test Conditions (Hard Performance Metrics)

| ID | Category | Setup | Action | Success Invariant |
|:---|:---|:---|:---|:---|
| **T1** | Trie Speed | 100k tokens in Radix Tree | 50k wildcards/sec | Resolution <300μs; RAM <50MB |
| **T2** | Resilience | Active Anchor (5 agents) | `SIGKILL` Daemon | Bosun restarts <5s; Zero state loss |
| **T3** | Economy | One Anchor, 500 cr | 50 concurrent `pd done` | Exactly 1 payout; Correct Merkle Root |
| **T4** | Win Security | Daemon as `UserA` | `UserB` connects to pipe | Connection Rejected (Access Denied) |
| **T5** | Backpressure | Flood logs (100MB/s) | Monitor event loop | Coordination jitter stays <1ms |

---

## 📈 5. Marketing & Monetization (Trust-as-a-Service)

### The Narrative: "Binding Agreements for Autonomous Agents"
Port Daddy V4 is not a tool; it's a **Trust Layer**. Agents today are unreliable; V4 makes them accountable through the Anchor Protocol.

### Monetization: The TaaS Model
1.  **Free (OSS / Local)**: All core kernel features, local swarms, unlimited SQLite memory.
2.  **Pro ($29/mo)**: Access to the `lighthouse.portdaddy.dev` Relay. Enables secure tunneling between your own machines (Home GPU + Work Laptop).
3.  **Marketplace Fee (15%)**: A coordination tax on all cross-harbor credit transactions settled on the Lighthouse Relay. We provide the **reputation attestation**.

---

## 🗺️ 6. Implementation Roadmap

### Phase 0: The Reactive Kernel (Weeks 1-2)
- Fastify/Bun migration.
- UDS/Named Pipe abstraction with SDDL hardening.
- Layered Resurrection (Bosun sidecar refactor).

### Phase 1: The Graph & Trie (Weeks 3-4)
- Radix Tree implementation with Harbor Bitmasks.
- Lazy Promotion engine.
- Dashboard Graph Visualizer (React + SSE).

### Phase 2: The Anchor Economy (Weeks 5-7)
- Merkleized Session Note chains.
- Bilateral Receipt signing (ed25519).
- Idempotent Settlement API.

### Phase 3: Lighthouses & Tunnels (Weeks 8-10)
- mDNS discovery & WSS Peering.
- Cross-daemon Harbor Tokens.
- Lighthouse Relay MVP.
