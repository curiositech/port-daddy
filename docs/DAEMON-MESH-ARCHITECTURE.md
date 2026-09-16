<!-- RETIRED-BY: ADR-0126 -->
> ## ⚓ Retired — superseded, kept as history
>
> The peer mesh described here — leader election, multi-writer
> replication, peer-to-peer state sync — is **superseded by the
> authority-domain model**: one writer lease per harbor with authority
> epochs and no election ([ADR-0122](adr/0122-harbor-authority.md)),
> plus relay event federation ([ADR-0027](adr/0027-relay-harbor-mesh.md),
> [ADR-0049](adr/0049-relay-architecture.md)).
>
> The V4 "Part XVII" trap this design belongs to stays closed.
>
> **Authority:** [ADR-0126 — Shared-Harbors Re-sequencing](adr/0126-shared-harbors-resequencing.md), § Formal supersessions.
> This document is retained deliberately: the 2026-06-05 operator rule is
> demote by default, delete only a merged twin. Read it for the reasoning
> that was current when it was written, not for what to build now.

---

# Port Daddy Daemon Mesh Architecture

**Author:** Erich Owens (with architecture by Claude)
**Date:** March 2026
**Status:** SUPERSEDED (2026-08) — kept for historical rationale only, not a live design
**Prerequisite:** V4 Phase 5 (The Network) in the Unified Roadmap

> **This document is the "Part XVII" approach that ADR-0027 (Relay Harbor Mesh)
> explicitly rejected.** Raft-inspired leader election, multi-writer SQLite
> avoidance via a single canonical leader, HLC clocks, and Merkle-hash state
> diffing are all **not** the shipped design. The accepted decision is much
> smaller: a harbor whose *membership* is shared across daemons via
> out-of-band Ed25519 keypair exchange, with **pub/sub event federation**
> (not state replication) over the PD Relay under harbor-fingerprint
> namespacing. Session/lock/note state stays local to each daemon — that is
> a deliberate privacy property, not a gap to close later. See ADR-0027,
> ADR-0049 (Relay v0 Architecture, Accepted, shipped in `apps/relay/`), and
> `skills/pd-relay-zero-trust/references/v4-remote-harbor-redefinition.md`
> for the full rationale. This document remains here because ADR-0049 cites
> it as the "why not the daemon mesh" counterfactual — read it as archived
> reasoning, not a roadmap.
>
> The **mDNS/Tailscale-API discovery layer** described in this document under
> "Three discovery layers" is a separate concern from state sync and is
> *not* superseded — it maps to what PLAN.md calls "Lighthouse" (a phone-book
> discovery registry, no traffic, no history), which the relay-era doctrine
> explicitly keeps as its own plane. Do not read the discovery-layer content
> here as dead; only the leader-election/state-sync/Merkle machinery is.

---

## Executive Summary

The Daemon Mesh extends Port Daddy from a single-machine coordination daemon to a multi-node coordination plane. Two or more PD instances discover each other, negotiate a leader, and present a unified view of agents, sessions, locks, and pub/sub across machines. The mesh is designed for the first target topology: a MacBook Pro and a gaming PC on the same LAN via Tailscale, then scales to teams.

Key architectural decisions:

1. **Strong leader with Raft-inspired consensus** for locks and session lifecycle. No multi-writer SQLite. The leader holds the canonical database; followers maintain read replicas plus local-only tables.
2. **Three discovery layers** (mDNS for LAN, Tailscale API for overlay networks, explicit pairing for everything else) with a unified peer registry.
3. **Federated read, consensus write**: Every node can read its own state and mesh state. Writes to shared state (locks, sessions, file claims) route through the leader. Local state (port claims, tunnels, system ports) stays local.
4. **JSON over HTTP** as the wire protocol, reusing the existing API surface. No new serialization format. WebSocket for persistent cross-node pub/sub bridging.
5. **mTLS with node certificates** derived from the existing master key infrastructure. Harbor Cards extended with a `node` scope for cross-node authentication.

---

## 1. System Architecture

```
                         ┌─────────────────────────────────┐
                         │         Tailscale Network        │
                         │    (or LAN, or Public Internet)  │
                         └──────────┬──────────┬───────────┘
                                    │          │
                    ┌───────────────┴──┐  ┌────┴───────────────┐
                    │  Node A (Leader)  │  │  Node B (Follower) │
                    │  MacBook Pro      │  │  Gaming PC         │
                    │                   │  │                    │
                    │  ┌─────────────┐  │  │  ┌─────────────┐  │
                    │  │ PD Daemon   │  │  │  │ PD Daemon   │  │
                    │  │ :9876       │◄─┼──┼──┤ :9876       │  │
                    │  │             │──┼──┼──►             │  │
                    │  └──────┬──────┘  │  │  └──────┬──────┘  │
                    │         │         │  │         │         │
                    │  ┌──────┴──────┐  │  │  ┌──────┴──────┐  │
                    │  │  SQLite DB  │  │  │  │  SQLite DB  │  │
                    │  │  (primary)  │  │  │  │  (replica)  │  │
                    │  │             │  │  │  │ + local tbls│  │
                    │  └─────────────┘  │  │  └─────────────┘  │
                    │                   │  │                    │
                    │  Local agents     │  │  Local agents      │
                    │  Local ports      │  │  Local ports       │
                    │  Local tunnels    │  │  Local tunnels     │
                    └───────────────────┘  └────────────────────┘
```

### Node Identity

Every node in the mesh has a stable identity:

```typescript
interface NodeIdentity {
  nodeId: string;         // UUID, generated on first mesh join, persisted in ~/.port-daddy/node-id
  hostname: string;       // os.hostname()
  platform: string;       // 'darwin' | 'linux' | 'win32'
  version: string;        // PD version
  codeHash: string;       // Current code hash (stale detection)
  listenAddr: string;     // 'tailscale:100.x.y.z:9876' | 'lan:192.168.1.5:9876'
  capabilities: string[]; // ['gpu', 'ollama', 'docker'] — what this machine offers
  meshPort: number;       // Dedicated mesh communication port (9877)
}
```

The `nodeId` is a UUID generated once and stored at `~/.port-daddy/node-id`. It survives daemon restarts, IP changes, and hostname changes. This is the stable key for Raft log entries and cross-node references.

---

## 2. Discovery

Three layers, tried in order. Any layer that produces a peer triggers a handshake.

### 2A. mDNS / Bonjour (Layer 1 — Zero-Config LAN)

For machines on the same physical network. Uses the `multicast-dns` npm package (pure JS, no native dependencies).

```
Service Type: _portdaddy._tcp.local
TXT Record:
  nodeId=<uuid>
  version=<semver>
  meshPort=9877
  codeHash=<12-char-hash>
```

**Behavior:**
- On daemon start, advertise via mDNS
- Continuously listen for other `_portdaddy._tcp.local` advertisements
- When a new peer appears, initiate handshake
- When a peer disappears (mDNS goodbye), mark peer as `unreachable` (not immediately removed — may be transient)

**Implementation:**

```typescript
// lib/mesh/discovery-mdns.ts
import mdns from 'multicast-dns';

export function createMdnsDiscovery(nodeIdentity: NodeIdentity, onPeerDiscovered: PeerCallback) {
  const instance = mdns();

  // Advertise ourselves
  instance.on('query', (query) => {
    for (const q of query.questions) {
      if (q.name === '_portdaddy._tcp.local' && q.type === 'PTR') {
        instance.respond({
          answers: [{
            name: '_portdaddy._tcp.local',
            type: 'PTR',
            data: `${nodeIdentity.nodeId}._portdaddy._tcp.local`
          }],
          additionals: [
            { name: `${nodeIdentity.nodeId}._portdaddy._tcp.local`, type: 'SRV',
              data: { port: nodeIdentity.meshPort, target: nodeIdentity.hostname } },
            { name: `${nodeIdentity.nodeId}._portdaddy._tcp.local`, type: 'TXT',
              data: [`nodeId=${nodeIdentity.nodeId}`, `version=${nodeIdentity.version}`] }
          ]
        });
      }
    }
  });

  // Discover peers
  const probeInterval = setInterval(() => {
    instance.query({ questions: [{ name: '_portdaddy._tcp.local', type: 'PTR' }] });
  }, 15000);  // Probe every 15 seconds

  return { stop: () => { clearInterval(probeInterval); instance.destroy(); } };
}
```

### 2B. Tailscale API (Layer 2 — Overlay Network)

For machines connected via Tailscale but not on the same LAN. Queries the Tailscale local API to find peers running PD.

```typescript
// lib/mesh/discovery-tailscale.ts

interface TailscaleStatus {
  Self: { TailscaleIPs: string[]; HostName: string };
  Peer: Record<string, { TailscaleIPs: string[]; HostName: string; Online: boolean; Tags?: string[] }>;
}

export async function createTailscaleDiscovery(
  nodeIdentity: NodeIdentity,
  onPeerDiscovered: PeerCallback
) {
  // Tailscale local API is at a fixed socket or HTTP address
  const status = await fetch('http://localhost:41112/localapi/v0/status', {
    headers: { 'Authorization': `Bearer ${await getTailscaleApiKey()}` }
  }).then(r => r.json()) as TailscaleStatus;

  // For each online peer, probe port 9877 for a PD mesh endpoint
  for (const [id, peer] of Object.entries(status.Peer)) {
    if (!peer.Online) continue;
    const ip = peer.TailscaleIPs[0];  // IPv4 preferred

    try {
      const probe = await fetch(`http://${ip}:9877/mesh/handshake`, {
        signal: AbortSignal.timeout(3000),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: nodeIdentity })
      });
      if (probe.ok) {
        const peerIdentity = await probe.json() as NodeIdentity;
        onPeerDiscovered(peerIdentity, `tailscale:${ip}:9877`);
      }
    } catch {
      // Peer exists on Tailscale but doesn't run PD — skip
    }
  }
}
```

**Polling interval:** Every 60 seconds. Tailscale peer changes are infrequent.

### 2C. Explicit Pairing (Layer 3 — Manual)

For networks where neither mDNS nor Tailscale works. The user runs:

```bash
# On the machine that should join
pd mesh join <address>

# Examples:
pd mesh join 192.168.1.42:9877
pd mesh join macbook.tail12345.ts.net:9877
pd mesh join lighthouse.portdaddy.dev   # Future: relay server
```

This sends a handshake request directly. The address is persisted in `~/.port-daddy/peers.json` and retried on daemon restart.

### 2D. Unified Peer Registry

All three discovery layers feed into a single peer registry:

```typescript
// lib/mesh/peers.ts

interface MeshPeer {
  nodeId: string;
  hostname: string;
  address: string;          // 'ip:port'
  discoveredVia: 'mdns' | 'tailscale' | 'explicit';
  role: 'leader' | 'follower' | 'candidate';
  status: 'connected' | 'unreachable' | 'handshaking';
  lastSeen: number;
  version: string;
  codeHash: string;
  capabilities: string[];
  rtt: number;              // Last measured round-trip time in ms
  term: number;             // Raft term this peer last reported
}
```

**Stored in:** `~/.port-daddy/mesh-peers.db` (separate SQLite database — mesh state must survive primary DB rebuilds).

```sql
CREATE TABLE mesh_peers (
  node_id     TEXT PRIMARY KEY,
  hostname    TEXT NOT NULL,
  address     TEXT NOT NULL,
  discovered_via TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'follower',
  status      TEXT NOT NULL DEFAULT 'handshaking',
  last_seen   INTEGER NOT NULL,
  version     TEXT,
  code_hash   TEXT,
  capabilities TEXT,          -- JSON array
  rtt_ms      INTEGER,
  raft_term   INTEGER DEFAULT 0,
  joined_at   INTEGER NOT NULL
);
```

---

## 3. Consensus: Raft-Inspired Leader Election

Full Raft is overkill for 2-5 nodes. We implement a simplified Raft with these constraints:

- **No log replication** (we use WAL shipping instead — see Section 5)
- **Leader election** follows Raft rules faithfully
- **Term numbers** prevent split-brain
- **Heartbeats** from leader to followers (not the reverse — avoids confusion with agent heartbeats)

### 3A. State Machine

```
                    ┌──────────────┐
            timeout │              │ receives higher term
         ┌─────────►  CANDIDATE   ├──────────────┐
         │          │              │              │
         │          └──────┬───────┘              │
         │                 │                      │
         │        wins     │ loses or             │
         │       election  │ discovers leader     │
         │                 │                      │
    ┌────┴────┐     ┌──────▼───────┐              │
    │         │     │              │◄─────────────┘
    │FOLLOWER │◄────┤   LEADER     │
    │         │     │              │
    └─────────┘     └──────────────┘
```

### 3B. Election Protocol

```typescript
interface RaftState {
  currentTerm: number;     // Monotonically increasing
  votedFor: string | null; // nodeId voted for in current term
  role: 'follower' | 'candidate' | 'leader';
  leaderId: string | null;
  electionTimeout: number; // Randomized: 300-500ms for mesh, not per-request
  lastHeartbeat: number;
}
```

**Election rules (faithful to Raft):**

1. Follower has not received leader heartbeat within election timeout
2. Follower increments term, votes for itself, becomes candidate
3. Candidate sends `RequestVote` to all peers
4. Peer grants vote if: (a) candidate's term >= peer's term, (b) peer has not voted in this term
5. Candidate receiving majority becomes leader
6. Leader sends heartbeats every 150ms to prevent new elections

**Two-node special case:** With exactly 2 nodes, majority = 2. If the network partitions, neither node can become leader alone. This is correct behavior (safety over availability). The surviving node continues serving local operations; mesh operations queue until reconnection.

```typescript
// lib/mesh/raft.ts

export function createRaftNode(nodeId: string, peers: MeshPeer[]) {
  let state: RaftState = {
    currentTerm: 0,
    votedFor: null,
    role: 'follower',
    leaderId: null,
    electionTimeout: 300 + Math.random() * 200,
    lastHeartbeat: Date.now()
  };

  // Persisted to ~/.port-daddy/raft-state.json between restarts
  // Term and votedFor MUST survive restarts to prevent double-voting

  async function requestVote(candidateId: string, term: number): Promise<{
    voteGranted: boolean;
    term: number;
  }> {
    if (term < state.currentTerm) {
      return { voteGranted: false, term: state.currentTerm };
    }

    if (term > state.currentTerm) {
      state.currentTerm = term;
      state.votedFor = null;
      state.role = 'follower';
    }

    if (state.votedFor === null || state.votedFor === candidateId) {
      state.votedFor = candidateId;
      persistState(state);
      return { voteGranted: true, term: state.currentTerm };
    }

    return { voteGranted: false, term: state.currentTerm };
  }

  async function appendEntries(leaderId: string, term: number): Promise<{
    success: boolean;
    term: number;
  }> {
    if (term < state.currentTerm) {
      return { success: false, term: state.currentTerm };
    }

    state.currentTerm = term;
    state.leaderId = leaderId;
    state.role = 'follower';
    state.lastHeartbeat = Date.now();
    return { success: true, term: state.currentTerm };
  }

  return { requestVote, appendEntries, getState: () => state };
}
```

### 3C. What Requires Consensus vs. What Doesn't

| Operation | Consensus Required? | Rationale |
|-----------|-------------------|-----------|
| Port claims | NO (local) | Ports are physical — only meaningful on the local machine |
| Tunnel start/stop | NO (local) | Tunnel processes are local OS processes |
| System ports scan | NO (local) | `lsof`/`ss` output is machine-specific |
| DNS records | NO (local) | `/etc/hosts` is per-machine |
| Agent registration | FEDERATED (leader-write) | All nodes need to see all agents |
| Agent heartbeat | LOCAL (with async replication) | Performance-critical — replicated lazily |
| Session start/end | CONSENSUS (leader-write) | Session lifecycle must be globally consistent |
| Session notes | FEDERATED (leader-write) | Notes are immutable — write-once semantics simplify this |
| File claims | CONSENSUS (leader-write) | Cross-node conflict detection is the whole point |
| Lock acquire/release | CONSENSUS (leader-write, sync) | Locks MUST be globally consistent — the most critical operation |
| Pub/sub publish | FEDERATED (local + bridge) | Published locally, bridged to peers asynchronously |
| Pub/sub subscribe | LOCAL (with bridge) | Subscription is local; bridge delivers remote messages |
| Salvage/resurrection | CONSENSUS (leader-write) | Prevents two nodes from claiming the same dead agent |
| Arbiter violations | LOCAL (with replication) | Each node runs its own Arbiter, violations replicated for visibility |
| Harbor membership | FEDERATED (leader-write) | Harbors span the mesh |
| Activity log | LOCAL (with merge) | High-volume, append-only — merged for queries, not replicated in real-time |

---

## 4. Federation Model

### 4A. Operation Routing

Every daemon instance runs the full Express API surface locally. The mesh layer intercepts writes to federated tables and routes them:

```
                    Client Request
                         │
                         ▼
                 ┌───────────────┐
                 │  Local Daemon  │
                 │  (Express)     │
                 └───────┬───────┘
                         │
                    ┌────┴────┐
                    │ Is this  │
                    │ a mesh   │
                    │ operation│
                    │    ?     │
                    └────┬────┘
                    YES  │  NO
              ┌──────────┴────────────┐
              │                       │
         ┌────▼─────┐          ┌──────▼──────┐
         │ Am I the  │          │ Execute     │
         │ leader?   │          │ locally     │
         └────┬──────┘          │ (ports,     │
         YES  │  NO             │  tunnels,   │
         ┌────┴────┐            │  system)    │
         │         │            └─────────────┘
    ┌────▼───┐ ┌───▼────┐
    │Execute │ │Forward │
    │locally │ │to      │
    │+ repli │ │leader  │
    │cate    │ │        │
    └────────┘ └────────┘
```

### 4B. Mesh Middleware

```typescript
// lib/mesh/middleware.ts

type OperationScope = 'local' | 'federated' | 'consensus';

const OPERATION_SCOPES: Record<string, OperationScope> = {
  // Local-only
  'POST /claim':           'local',
  'DELETE /release':       'local',
  'POST /tunnel':          'local',
  'GET /ports/system':     'local',
  'GET /ports/active':     'local',

  // Federated (leader-write, any-read)
  'POST /agents':          'federated',
  'PUT /agents/:id/heartbeat': 'local',  // Replicated lazily
  'POST /sessions':        'consensus',
  'PUT /sessions/:id':     'consensus',
  'POST /notes':           'federated',  // Immutable, write-once; sessionId in body when targeted
  'POST /sessions/:id/notes': 'federated',  // Compatibility alias for POST /notes
  'POST /sessions/:id/files': 'consensus',  // Conflict detection
  'POST /msg/:channel':    'federated',

  // Consensus (strong consistency required)
  'POST /locks/:name':     'consensus',
  'PUT /locks/:name':      'consensus',
  'DELETE /locks/:name':   'consensus',
  'POST /salvage/claim':   'consensus',
};

export function createMeshMiddleware(raft: RaftNode, peers: PeerRegistry) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.method} ${routePattern(req.path)}`;
    const scope = OPERATION_SCOPES[key] || 'local';

    if (scope === 'local') {
      return next();  // Execute on this node
    }

    if (raft.getState().role === 'leader') {
      // We are the leader — execute locally, then replicate
      req.meshContext = { scope, replicateAfter: true };
      return next();
    }

    if (raft.getState().leaderId === null) {
      // No leader — mesh is partitioned
      if (scope === 'consensus') {
        return res.status(503).json({
          error: 'Mesh has no leader — consensus operations unavailable',
          hint: 'Local operations still work. Wait for leader election or check mesh status.',
          retryAfter: 5
        });
      }
      // Federated reads still work against local data
      return next();
    }

    // Forward to leader
    const leader = peers.get(raft.getState().leaderId!);
    return forwardToLeader(req, res, leader);
  };
}
```

### 4C. Query Federation

Read queries merge local and mesh data:

```typescript
// GET /agents — federated read
app.get('/agents', meshMiddleware, (req, res) => {
  const localAgents = agents.list();

  if (mesh.isConnected()) {
    // Annotate each agent with its origin node
    const allAgents = mesh.federatedQuery('/agents', {
      merge: (local, remote) => {
        return [
          ...local.agents.map(a => ({ ...a, node: mesh.nodeId, isLocal: true })),
          ...remote.flatMap(r =>
            r.agents.map(a => ({ ...a, node: r.nodeId, isLocal: false }))
          )
        ];
      }
    });
    return res.json(allAgents);
  }

  return res.json(localAgents);
});
```

---

## 5. State Replication

### 5A. Hybrid Model: Local Tables + Replicated Tables

SQLite is single-writer. We do NOT attempt multi-writer replication. Instead:

```
┌─────────────────────────────────────────┐
│              Leader Node                 │
│                                          │
│  ┌──────────────┐  ┌──────────────────┐ │
│  │ Local Tables  │  │ Replicated Tables│ │
│  │              │  │                  │ │
│  │ services     │  │ agents           │ │
│  │ endpoints    │  │ sessions         │ │
│  │ tunnels      │  │ session_notes    │ │
│  │ dns_records  │  │ session_files    │ │
│  │ system_ports │  │ locks            │ │
│  │              │  │ resurrection_q   │ │
│  │              │  │ harbors          │ │
│  │              │  │ harbor_members   │ │
│  │              │  │ graph_edges      │ │
│  │              │  │ messages (recent)│ │
│  └──────────────┘  └────────┬─────────┘ │
│                             │            │
│                        WAL changes       │
│                             │            │
└─────────────────────────────┼────────────┘
                              │
                    ┌─────────▼──────────┐
                    │  Replication Stream │
                    │  (WebSocket)        │
                    └─────────┬──────────┘
                              │
┌─────────────────────────────┼────────────┐
│              Follower Node  │            │
│                             ▼            │
│  ┌──────────────┐  ┌──────────────────┐ │
│  │ Local Tables  │  │ Replicated Tables│ │
│  │ (own data)   │  │ (read-only copy) │ │
│  └──────────────┘  └──────────────────┘ │
└──────────────────────────────────────────┘
```

### 5B. Change Data Capture (CDC) via Triggers

The leader captures changes to replicated tables using SQLite triggers that write to a change log:

```sql
CREATE TABLE IF NOT EXISTS mesh_changelog (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  operation  TEXT NOT NULL,  -- 'INSERT', 'UPDATE', 'DELETE'
  row_key    TEXT NOT NULL,  -- Primary key of affected row
  row_data   TEXT,           -- JSON snapshot of row (NULL for DELETE)
  term       INTEGER NOT NULL,
  timestamp  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mesh_changelog_seq ON mesh_changelog(seq);

-- Example trigger for the agents table
CREATE TRIGGER IF NOT EXISTS mesh_cdc_agents_insert
AFTER INSERT ON agents
BEGIN
  INSERT INTO mesh_changelog (table_name, operation, row_key, row_data, term, timestamp)
  VALUES ('agents', 'INSERT', NEW.id,
    json_object('id', NEW.id, 'name', NEW.name, 'pid', NEW.pid,
                'registered_at', NEW.registered_at,
                'last_heartbeat', NEW.last_heartbeat,
                'metadata', NEW.metadata,
                'purpose', NEW.purpose,
                'status', NEW.status),
    (SELECT value FROM mesh_state WHERE key = 'current_term'),
    unixepoch('now') * 1000);
END;

-- Similar triggers for UPDATE and DELETE on each replicated table
```

**Changelog compaction:** The changelog is truncated after all followers have acknowledged a sequence number. Compaction runs every 5 minutes. Entries older than 1 hour are always removed (followers that far behind must full-sync).

### 5C. Replication Protocol

```typescript
// lib/mesh/replication.ts

interface ReplicationMessage {
  type: 'sync' | 'full-sync-request' | 'full-sync-response' | 'ack';
  fromNode: string;
  term: number;
}

interface SyncMessage extends ReplicationMessage {
  type: 'sync';
  changes: ChangelogEntry[];
  lastSeq: number;
}

interface ChangelogEntry {
  seq: number;
  tableName: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  rowKey: string;
  rowData: Record<string, unknown> | null;
  term: number;
  timestamp: number;
}
```

**Sync flow:**

1. Leader maintains a WebSocket connection to each follower
2. On each change to a replicated table, the CDC trigger fires
3. Every 100ms (batched), the leader sends accumulated changes to all followers
4. Followers apply changes to their local replica tables in a transaction
5. Followers send ACK with the last applied sequence number
6. Leader tracks each follower's acknowledged seq for changelog compaction

**Full sync** (new follower joining or follower that's too far behind):

1. Follower sends `full-sync-request`
2. Leader snapshots all replicated tables as JSON
3. Leader sends `full-sync-response` with the complete dataset + current seq
4. Follower drops and recreates replicated tables, applies the snapshot
5. Normal CDC streaming resumes from the snapshot's seq

### 5D. Conflict Resolution

Since all writes to replicated tables go through the leader, there are no write conflicts. The leader is the single source of truth. If the leader fails:

1. A new leader is elected (Raft)
2. The new leader's replicated tables become authoritative
3. Other followers re-sync from the new leader

**Data loss window:** Changes that the old leader accepted but hadn't replicated to the new leader are lost. This window is bounded by the replication batch interval (100ms). For the two-machine case, this means at most 100ms of changes can be lost on leader failover.

This is an acceptable tradeoff for a development coordination tool. If stronger guarantees are needed, the batch interval can be reduced to 0 (synchronous replication), at the cost of write latency.

---

## 6. Network Partition Handling

### 6A. CAP Theorem Position

Port Daddy Mesh chooses **CP** (Consistency + Partition tolerance) for consensus operations and **AP** (Availability + Partition tolerance) for local operations.

```
┌──────────────────────────────────────────────────────┐
│                  Network Partition                     │
│                                                        │
│  ┌─────────────────┐         ┌─────────────────┐     │
│  │ Partition A      │         │ Partition B      │     │
│  │ (has majority)   │         │ (minority)       │     │
│  │                  │  SPLIT  │                  │     │
│  │ Leader elected   │◄──X──►│ No leader         │     │
│  │ Consensus: YES   │         │ Consensus: NO    │     │
│  │ Local ops: YES   │         │ Local ops: YES   │     │
│  │ Reads: FULL      │         │ Reads: STALE OK  │     │
│  └─────────────────┘         └─────────────────┘     │
│                                                        │
│  On heal: minority re-syncs from majority leader       │
└──────────────────────────────────────────────────────┘
```

### 6B. Behavior During Partition

| Operation | Majority Partition | Minority Partition |
|-----------|-------------------|-------------------|
| Port claims | Works (local) | Works (local) |
| Agent registration | Works (leader-write) | Queued locally, replayed on heal |
| Lock acquire | Works (consensus) | Fails with 503 + retryAfter |
| Lock release | Works (consensus) | Fails with 503 — lock held until heal |
| Session start | Works (consensus) | Fails with 503 |
| Session notes | Works (leader-write) | Queued locally, replayed on heal |
| File claims | Works (consensus) | Fails with 503 |
| Pub/sub (local) | Works | Works |
| Pub/sub (cross-node) | Works within partition | No cross-partition delivery |
| Salvage claim | Works (consensus) | Fails with 503 |
| Arbiter | Works locally | Works locally |
| Dashboard reads | Full mesh view | Stale mesh data + live local data |

### 6C. Write Queue for Minority Partition

When a node is in the minority partition and cannot reach the leader, federated writes are queued locally:

```sql
CREATE TABLE IF NOT EXISTS mesh_write_queue (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  method     TEXT NOT NULL,      -- 'POST', 'PUT', 'DELETE'
  path       TEXT NOT NULL,      -- '/agents', '/notes'
  body       TEXT,               -- JSON request body
  queued_at  INTEGER NOT NULL,
  replayed   INTEGER DEFAULT 0,
  replayed_at INTEGER
);
```

On partition heal:
1. Minority node detects leader (via heartbeat)
2. Queued writes are replayed to the leader in order
3. Conflicts (e.g., lock acquired by someone else during partition) are reported to the user via pub/sub on `mesh:conflicts` channel

### 6D. Two-Node Special Case

With exactly two nodes, any partition means no majority exists. Both nodes degrade to local-only mode. This is the correct, safe behavior.

**Recommendation for the first deployment (MacBook + Gaming PC):** Accept this constraint. In practice, both machines will be on the same Tailscale network and partitions will be rare. If higher availability is needed, add a third node (a Raspberry Pi running PD in headless mode makes an excellent tiebreaker).

---

## 7. Wire Protocol

### 7A. Design Decision: JSON over HTTP + WebSocket

The mesh uses the existing HTTP API for request/response operations and WebSocket for streaming (replication, pub/sub bridging, heartbeats).

**Why not Protobuf or gRPC:**
- PD is a development tool, not a high-frequency trading system
- JSON is debuggable with `curl`
- The existing Express API already speaks JSON
- Adding Protobuf would mean maintaining two serialization layers
- The mesh handles hundreds of operations per minute, not thousands per second

**Why WebSocket for streaming (not SSE):**
- SSE is unidirectional; mesh replication needs bidirectional ACKs
- WebSocket has lower overhead for high-frequency heartbeats
- Node.js `ws` library is mature and battle-tested

### 7B. Mesh API Endpoints

A dedicated Express app on port 9877 (meshPort) handles inter-node communication:

```
┌──────────────────────────────────────────────────────────┐
│                    Mesh API (:9877)                        │
├──────────────────┬───────────────────────────────────────┤
│ Endpoint         │ Purpose                                │
├──────────────────┼───────────────────────────────────────┤
│ POST /handshake  │ Initial peer discovery handshake       │
│ POST /vote       │ Raft RequestVote RPC                   │
│ POST /heartbeat  │ Raft AppendEntries (leader heartbeat)  │
│ GET  /status     │ Node status (role, term, peers)        │
│ GET  /tables/:t  │ Full-sync: dump replicated table       │
│ POST /forward    │ Forward client request to leader       │
│ WS   /replicate  │ CDC replication stream (leader→follower)│
│ WS   /pubsub     │ Cross-node pub/sub bridge              │
│ GET  /health     │ Mesh health (connectivity, lag)        │
└──────────────────┴───────────────────────────────────────┘
```

**Why a separate port?**

- The main API (:9876) serves local agents and the dashboard. Its rate limiting, CORS, and Host header validation are tuned for localhost clients.
- The mesh API (:9877) serves peer daemons. It needs mTLS, different rate limits, and accepts connections from non-localhost addresses.
- Separation prevents mesh traffic from interfering with local agent coordination.

### 7C. Message Format

All mesh messages include a common envelope:

```typescript
interface MeshEnvelope {
  fromNode: string;      // sender's nodeId
  toNode: string | '*';  // recipient nodeId or broadcast
  term: number;          // sender's current Raft term
  timestamp: number;     // sender's wall clock (for debugging, not consensus)
  signature: string;     // HMAC-SHA256 of payload (see Security section)
  payload: unknown;      // Operation-specific data
}
```

---

## 8. Pub/Sub Across Nodes

### 8A. Architecture

Each node runs its own pub/sub engine (the existing `createMessaging` module). Cross-node message delivery uses a WebSocket bridge between every pair of connected nodes.

```
  Node A (Leader)                    Node B (Follower)
  ┌──────────────────┐              ┌──────────────────┐
  │ Local Pub/Sub    │              │ Local Pub/Sub    │
  │                  │    WS        │                  │
  │  Channel: build  │◄────────────►│  Channel: build  │
  │  Channel: agents │◄────────────►│  Channel: agents │
  │  Channel: test   │              │  Channel: test   │
  │                  │              │                  │
  │  Agent A1 sub'd  │              │  Agent B1 sub'd  │
  │  to 'build'      │              │  to 'build'      │
  └──────────────────┘              └──────────────────┘

  When Agent A1 publishes to 'build':
  1. Local subscribers on Node A receive it immediately
  2. Bridge forwards to Node B's pub/sub engine
  3. Local subscribers on Node B (Agent B1) receive it
```

### 8B. Bridge Implementation

```typescript
// lib/mesh/pubsub-bridge.ts

export function createPubSubBridge(
  localMessaging: ReturnType<typeof createMessaging>,
  peerWebSocket: WebSocket,
  peerNodeId: string
) {
  // Forward locally published messages to the peer
  // Uses a "mesh-origin" marker to prevent infinite loops
  localMessaging.onPublish((channel, message) => {
    if (message._meshOrigin) return;  // Don't re-bridge bridged messages

    peerWebSocket.send(JSON.stringify({
      type: 'pubsub',
      channel,
      message: { ...message, _meshOrigin: localNodeId },
    }));
  });

  // Receive messages from peer and publish locally
  peerWebSocket.on('message', (data) => {
    const envelope = JSON.parse(data.toString());
    if (envelope.type !== 'pubsub') return;

    localMessaging.publish(envelope.channel, {
      ...envelope.message,
      _meshOrigin: peerNodeId,  // Mark so we don't re-bridge
      _meshNode: peerNodeId,    // Visible to subscribers
    });
  });
}
```

### 8C. Channel Scoping

Not all channels should bridge. Local-only channels (prefixed with `_local:`) stay on the originating node:

```typescript
const BRIDGE_EXCLUSIONS = [
  /^_local:/,           // Explicitly local
  /^dashboard:/,        // Dashboard SSE is per-node UI
  /^inbox:/,            // Agent inbox is per-agent, agent is on one node
];

function shouldBridge(channel: string): boolean {
  return !BRIDGE_EXCLUSIONS.some(re => re.test(channel));
}
```

### 8D. SSE Clients

The existing SSE subscription endpoint (`/subscribe/:channel` or `/msg/:channel/subscribe`) continues to work. Clients subscribe to their local daemon; the bridge ensures messages from remote nodes arrive at the local pub/sub engine and are delivered to local SSE clients transparently.

No client-side changes needed.

---

## 9. The Arbiter in Mesh Mode

### 9A. Design: Local Arbiter, Mesh Visibility

Each node runs its own Arbiter instance against its local state. The Arbiter does NOT run consensus; it observes.

```
  Node A                              Node B
  ┌────────────────────┐              ┌────────────────────┐
  │ Arbiter (local)    │              │ Arbiter (local)    │
  │                    │              │                    │
  │ Checks invariants  │              │ Checks invariants  │
  │ against local DB   │   replicate  │ against local DB   │
  │                    │──violations──►                    │
  │ 6 rules            │◄─violations──│ 6 rules            │
  │                    │              │                    │
  │ Violations logged  │              │ Violations logged  │
  │ locally + pub/sub  │              │ locally + pub/sub  │
  └────────────────────┘              └────────────────────┘
```

**Why not a mesh-wide Arbiter?**

1. The Arbiter checks invariants against **local state** (PID squatting, heartbeat freshness). These are inherently per-node.
2. A mesh-wide Arbiter would need to wait for full replication before checking — adding latency to every operation.
3. The Arbiter's purpose is fast local detection, not consensus. Making it distributed would make it slow and complex for no benefit.

### 9B. Mesh-Aware Rules

Some invariants gain mesh awareness:

```typescript
// LOCK_OWNER_VALID: In mesh mode, also verify the owner's agent is registered
// on SOME node (not just local). Uses federated read.
function checkLockOwnerValid_Mesh(lock: Lock): boolean {
  const localAgent = agents.get(lock.owner);
  if (localAgent) return true;

  // Check if any mesh peer has this agent
  const meshAgent = mesh.federatedQuery(`/agents/${lock.owner}`);
  return meshAgent !== null;
}

// NEW MESH RULE: VERSION_CONSISTENCY
// Warns if nodes are running different versions/codeHashes
function checkVersionConsistency(): Violation | null {
  const peers = mesh.getPeers();
  const versions = new Set(peers.map(p => p.version));
  if (versions.size > 1) {
    return {
      rule: 'VERSION_CONSISTENCY',
      severity: 'warning',
      details: `Mesh nodes running different versions: ${[...versions].join(', ')}`,
    };
  }
  return null;
}

// NEW MESH RULE: REPLICATION_LAG
// Warns if a follower is falling behind
function checkReplicationLag(): Violation | null {
  if (raft.role !== 'leader') return null;
  for (const peer of mesh.getPeers()) {
    const lag = currentSeq - peer.ackedSeq;
    if (lag > 1000) {
      return {
        rule: 'REPLICATION_LAG',
        severity: 'warning',
        details: `Follower ${peer.hostname} is ${lag} changes behind`,
      };
    }
  }
  return null;
}
```

### 9C. Violation Replication

Violations are published to the `arbiter:violations` pub/sub channel, which is bridged across nodes. Every node's dashboard shows all mesh violations.

---

## 10. Security

### 10A. Threat Model

The mesh connects machines on a private network (Tailscale or LAN). The primary threats are:

1. **Rogue node:** An unauthorized machine joins the mesh and reads/writes coordination state
2. **MITM:** An attacker on the network intercepts mesh traffic
3. **Replay:** An attacker replays old mesh messages
4. **Stolen credentials:** Node keys are exfiltrated from a compromised machine

### 10B. Node Authentication: mTLS with Self-Signed Certificates

Each node generates a TLS certificate on first `pd mesh init`. The certificate is self-signed, with the node's UUID as the Common Name.

```
~/.port-daddy/
  node-id              # UUID
  node-cert.pem        # Self-signed X.509 certificate
  node-key.pem         # Private key (4096-bit RSA or P-256 EC)
  trusted-nodes/       # Certificates of trusted peers
    <nodeId>.pem       # Copied during pairing
```

**Pairing ceremony:**

```bash
# Node A generates a one-time pairing code
$ pd mesh pair-code
Pairing code: HARBOR-TANGO-FOXTROT-42
Valid for 5 minutes.

# Node B uses the code to join
$ pd mesh join 192.168.1.42:9877 --code HARBOR-TANGO-FOXTROT-42
Exchanging certificates...
Peer "erich-macbook" (node a1b2c3d4) added to trusted nodes.
Mesh connected. You are a FOLLOWER. Leader: erich-macbook.
```

During pairing:
1. Node B sends `POST /mesh/pair` with the code
2. Node A verifies the code hasn't expired
3. Both nodes exchange certificates
4. Each node stores the peer's certificate in `trusted-nodes/`
5. All subsequent mesh connections use mTLS, rejecting any certificate not in `trusted-nodes/`

### 10C. Message Authentication

Every mesh message includes an HMAC-SHA256 signature over the payload, using a shared secret derived during pairing (ECDH key exchange between the two node key pairs).

```typescript
function signMeshMessage(payload: string, sharedSecret: Buffer): string {
  return createHmac('sha256', sharedSecret)
    .update(payload)
    .digest('hex');
}

function verifyMeshMessage(payload: string, signature: string, sharedSecret: Buffer): boolean {
  const expected = signMeshMessage(payload, sharedSecret);
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}
```

### 10D. Replay Protection

Each mesh message includes:
- `term`: Must be >= receiver's current term (Raft guarantees monotonicity)
- `timestamp`: Must be within 30 seconds of receiver's clock (rejects stale replays)
- `nonce`: Random 16-byte value, cached for 60 seconds (rejects immediate replays)

### 10E. Harbor Card Extension

The existing Harbor Card system (from the Bonded Commons paper) is extended with a `node` scope:

```typescript
interface HarborCard {
  // Existing fields
  agentId: string;
  capabilities: string[];
  harbors: string[];

  // New mesh fields
  nodeId?: string;         // Which node issued this card
  nodeScope?: 'local' | 'mesh';  // 'mesh' cards are valid on any node
}
```

A `mesh`-scoped Harbor Card, issued by the leader, is valid on any node in the mesh. A `local`-scoped card is only valid on the issuing node.

---

## 11. Implementation Phases

### Phase M1: Discovery + Read-Only Federation (4-6 weeks)

**Goal:** Two PD instances find each other and display each other's agents, sessions, and status in their dashboards.

**Deliverables:**

```
lib/mesh/
  node-identity.ts      # NodeIdentity generation and persistence
  discovery-mdns.ts     # mDNS advertisement and listening
  discovery-tailscale.ts # Tailscale peer probing
  discovery-explicit.ts # Manual pd mesh join
  peers.ts              # Unified peer registry (SQLite-backed)
  handshake.ts          # Peer handshake protocol
  mesh-server.ts        # Express app on port 9877
  mesh-health.ts        # Mesh connectivity and latency checks

routes/mesh.ts          # /mesh/* routes for the main daemon
cli/commands/mesh.ts    # pd mesh {status,join,peers,init}

completions/port-daddy.{bash,zsh,fish}  # Updated
```

**What works after M1:**
- `pd mesh init` generates node identity and certificates
- `pd mesh join <addr>` connects to a peer
- `pd mesh status` shows connected peers, roles, latency
- `pd mesh peers` lists all known peers with status
- Dashboard shows "Mesh" panel with connected nodes
- `pd agents` shows agents from all nodes (annotated with `node` field)
- `pd sessions` shows sessions from all nodes
- Read-only: no cross-node writes yet

**Key constraint:** All mesh reads are eventually consistent (polling, not streaming). This is fine for M1.

### Phase M2: Write Federation + Pub/Sub Bridge (4-6 weeks)

**Goal:** Agents on one machine can publish messages that agents on another machine receive. Agent registration and session notes are written through the leader.

**Deliverables:**

```
lib/mesh/
  raft.ts               # Simplified Raft (election + heartbeat only)
  replication.ts        # CDC triggers + WebSocket streaming
  pubsub-bridge.ts      # Cross-node pub/sub via WebSocket
  middleware.ts          # Request routing (local vs. leader)
  write-queue.ts        # Minority partition write queue
```

**What works after M2:**
- Leader election happens automatically
- `pd msg build "tests passed"` on Node A is received by `pd watch build` on Node B
- Agent registration on a follower is forwarded to the leader and replicated back
- Session notes created on any node are globally visible
- Partition detection: `pd mesh status` shows partition state
- Write queue: federated writes during partition are queued and replayed

### Phase M3: Consensus Operations (3-4 weeks)

**Goal:** Distributed locks, cross-machine file claims, and coordinated salvage work correctly with consistency guarantees.

**Deliverables:**

```
lib/mesh/
  consensus-lock.ts     # Lock acquire/release through leader with sync replication
  consensus-files.ts    # File claims with cross-node conflict detection
  consensus-salvage.ts  # Coordinated dead-agent claiming
  arbiter-mesh.ts       # Mesh-aware Arbiter rules (VERSION_CONSISTENCY, REPLICATION_LAG)
```

**What works after M3:**
- `pd lock deploy-prod` acquired on Node A blocks `pd lock deploy-prod` on Node B
- File claims on Node A are visible to agents on Node B (conflict warnings)
- `pd salvage claim <dead-agent>` works regardless of which node the agent died on
- The Arbiter reports cross-node version drift and replication lag

### Phase M4: Hardening + Polish (2-3 weeks)

**Goal:** Production-quality mesh for daily use.

**Deliverables:**
- Chaos testing: `pd mesh test --chaos` (simulates partitions, leader failure, slow followers)
- Mesh metrics in `/metrics` endpoint
- Dashboard: mesh topology visualization (node graph with health colors)
- `pd mesh leave` gracefully removes a node
- `pd mesh promote <nodeId>` forces leader transfer
- Automated mesh health alerts via webhooks
- Documentation: mesh setup guide, troubleshooting

---

## 12. Data Structures: Complete Schema

### 12A. New Tables (mesh-specific)

```sql
-- Stored in ~/.port-daddy/mesh-peers.db (separate from main DB)

CREATE TABLE mesh_peers (
  node_id        TEXT PRIMARY KEY,
  hostname       TEXT NOT NULL,
  address        TEXT NOT NULL,
  discovered_via TEXT NOT NULL CHECK(discovered_via IN ('mdns', 'tailscale', 'explicit')),
  role           TEXT NOT NULL DEFAULT 'follower' CHECK(role IN ('leader', 'follower', 'candidate')),
  status         TEXT NOT NULL DEFAULT 'handshaking'
                    CHECK(status IN ('connected', 'unreachable', 'handshaking', 'partitioned')),
  last_seen      INTEGER NOT NULL,
  last_acked_seq INTEGER DEFAULT 0,
  version        TEXT,
  code_hash      TEXT,
  capabilities   TEXT,  -- JSON array
  rtt_ms         INTEGER,
  raft_term      INTEGER DEFAULT 0,
  joined_at      INTEGER NOT NULL
);

-- Stored in main DB (leader only, triggers CDC)

CREATE TABLE mesh_changelog (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  operation  TEXT NOT NULL CHECK(operation IN ('INSERT', 'UPDATE', 'DELETE')),
  row_key    TEXT NOT NULL,
  row_data   TEXT,  -- JSON (NULL for DELETE)
  term       INTEGER NOT NULL,
  timestamp  INTEGER NOT NULL
);
CREATE INDEX idx_mesh_changelog_seq ON mesh_changelog(seq);
CREATE INDEX idx_mesh_changelog_ts ON mesh_changelog(timestamp);

-- Stored in main DB (followers during partition)

CREATE TABLE mesh_write_queue (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  method     TEXT NOT NULL,
  path       TEXT NOT NULL,
  body       TEXT,
  queued_at  INTEGER NOT NULL,
  replayed   INTEGER DEFAULT 0,
  replayed_at INTEGER
);
```

### 12B. Raft Persistent State

```json
// ~/.port-daddy/raft-state.json
{
  "currentTerm": 7,
  "votedFor": "a1b2c3d4-5678-9abc-def0-1234567890ab",
  "lastAppliedSeq": 4291
}
```

This file is `fsync`'d on every write. The Raft safety proof depends on `currentTerm` and `votedFor` surviving crashes.

### 12C. Node Identity

```json
// ~/.port-daddy/node-id
"a1b2c3d4-5678-9abc-def0-1234567890ab"
```

```json
// ~/.port-daddy/mesh-config.json
{
  "meshPort": 9877,
  "capabilities": ["gpu", "ollama", "docker"],
  "discoveryLayers": ["mdns", "tailscale"],
  "explicitPeers": ["100.64.1.42:9877"],
  "pairingEnabled": true
}
```

---

## 13. CLI Commands

```
pd mesh init                          # Generate node identity + certificates
pd mesh status                        # Show mesh status, role, peers, term
pd mesh join <addr> [--code <code>]   # Join a mesh by address
pd mesh leave                         # Gracefully leave the mesh
pd mesh peers                         # List all mesh peers with status
pd mesh pair-code                     # Generate a one-time pairing code
pd mesh promote <nodeId>              # Transfer leadership (leader only)
pd mesh test [--chaos]                # Run mesh health checks / chaos tests
pd mesh config                        # Show/edit mesh configuration
```

All commands support `--json` and `--quiet` flags per PD convention.

---

## 14. Dashboard Integration

The dashboard (`public/index.html`) gains a "Mesh" panel:

```
┌─────────────────────────────────────────────────────┐
│ MESH                                     ● LEADER   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────┐       ┌──────────┐                   │
│  │ erich-   │  5ms  │ gaming-  │                   │
│  │ macbook  │◄─────►│ pc       │                   │
│  │ (LEADER) │       │(FOLLOWER)│                   │
│  │ v3.8.0   │       │ v3.8.0   │                   │
│  │ 3 agents │       │ 7 agents │                   │
│  └──────────┘       └──────────┘                   │
│                                                     │
│  Term: 7  │  Repl. lag: 0  │  Uptime: 4h 23m      │
│  Changelog: 4,291 entries  │  Last election: 4h ago│
│                                                     │
│  [ Force Election ]  [ Transfer Leadership ]        │
└─────────────────────────────────────────────────────┘
```

Existing panels (Agents, Sessions, Locks, Salvage) gain a `node` column showing which machine each entry belongs to.

---

## 15. Cross-Platform Considerations

### macOS (launchd)

The mesh server runs as part of the existing `com.portdaddy.daemon` launchd service. The mesh Express app on port 9877 is started inside `server.ts` alongside the main app on 9876.

No additional launchd plist needed.

### Linux (systemd)

```ini
# /etc/systemd/system/port-daddy.service
[Unit]
Description=Port Daddy Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/node /opt/port-daddy/dist/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

The same binary handles both ports (9876 + 9877). systemd's `Restart=always` provides the equivalent of launchd's `KeepAlive`.

### Windows (future)

Named Pipes for local IPC (as specified in V4 Phase 4F). TCP for mesh. Windows Defender Firewall rules needed for port 9877.

---

## 16. Performance Considerations

### 16A. Latency Budget

| Operation | Local | Mesh (follower, forwarded to leader) |
|-----------|-------|--------------------------------------|
| Port claim | <1ms | N/A (local only) |
| Agent heartbeat | <1ms | <1ms (local, replicated async) |
| Lock acquire | <1ms | RTT + 1ms (forwarded) |
| Pub/sub publish | <1ms | <1ms local + RTT bridge |
| Session start | <1ms | RTT + 1ms (forwarded) |
| File claim | <1ms | RTT + 1ms (forwarded) |
| Federated read | <1ms | N/A (reads local replica) |

For a Tailscale connection between a MacBook and a gaming PC on the same LAN, RTT is typically 1-5ms. For remote Tailscale connections, RTT is 20-80ms. The forwarding overhead is negligible.

### 16B. Bandwidth

Estimated replication bandwidth for an active development session:

- Agent heartbeats: 10 agents x 1 heartbeat/30s x 200 bytes = 67 bytes/sec
- Session notes: 5 notes/min x 500 bytes = 42 bytes/sec
- Pub/sub bridge: 20 messages/min x 300 bytes = 100 bytes/sec
- CDC changelog: 50 changes/min x 400 bytes = 333 bytes/sec

**Total: ~550 bytes/sec (~2 KB/sec with overhead).** This is negligible even on the slowest Tailscale connections.

### 16C. SQLite Write Amplification

CDC triggers add one write to `mesh_changelog` for every write to a replicated table. This doubles the write volume on the leader. With WAL mode and the existing PASSIVE checkpoint strategy, this is not a concern for the expected load (hundreds of writes/minute, not thousands/second).

---

## 17. Migration Path: Single-Node to Mesh

### Backward Compatibility

A single-node PD instance with no mesh configuration behaves identically to pre-mesh PD. The mesh module is loaded but inactive:

```typescript
// In server.ts
const mesh = createMesh(db, {
  enabled: existsSync(join(homedir(), '.port-daddy', 'node-id')),
  // ...
});

if (!mesh.isEnabled()) {
  // All mesh middleware is no-op
  // All API responses omit mesh fields
  // Dashboard hides Mesh panel
}
```

### Opt-In Activation

```bash
# First time: generate identity
pd mesh init

# This creates ~/.port-daddy/node-id, generates certificates,
# and restarts the daemon with mesh enabled

# The daemon now listens on port 9877 for mesh connections
# and advertises via mDNS

# Connect to a peer
pd mesh join 100.64.1.42:9877 --code HARBOR-TANGO-42
```

### Version Compatibility

The mesh handshake includes version information. Nodes with incompatible versions (major version mismatch) refuse to mesh. Minor version differences are allowed with a warning from the Arbiter (VERSION_CONSISTENCY rule).

---

## 18. Open Questions

1. **Three-node minimum for production?** With two nodes, any partition loses consensus. Should we recommend a lightweight tiebreaker node (Raspberry Pi, always-on server)?

2. **Conflict resolution for write queues:** When a minority partition's queued writes conflict with changes made on the majority partition during the split, what's the resolution strategy? Currently: last-writer-wins with conflict notification. Is this sufficient?

3. **Encryption key distribution:** Should the master key (for note encryption) be shared across mesh nodes, or should each node have its own? If shared, how is it distributed securely? If separate, cross-node note decryption is impossible.

4. **Lighthouse relay (V4 Phase 5B):** The mesh architecture assumes direct connectivity (LAN or Tailscale). For public internet deployment without Tailscale, a relay server (`lighthouse.portdaddy.dev`) would be needed. This is out of scope for the initial implementation but the architecture should not preclude it.

5. **Agent migration:** Can an agent that's running on Node A be "migrated" to Node B? This would require transferring the agent's session, notes, and file claims. The architecture supports this (leader writes are global), but the UX and safety implications need design.

---

## 19. Relationship to V4 Roadmap

| V4 Phase | Mesh Dependency | Impact |
|----------|-----------------|--------|
| Phase 1 (Semantic Graph) | None | Graph edges are replicated tables — mesh-ready |
| Phase 2 (Economy) | Credits need consensus | Credit transfers are consensus operations — fits naturally |
| Phase 3 (Fleet & Memory) | Fleet agents span nodes | `pd fleet up` could schedule agents across machines based on capabilities |
| Phase 4 (Resilience) | Mesh benefits from perf work | Bun/Fastify migration improves mesh forwarding latency |
| Phase 5 (The Network) | **This document IS Phase 5A** | Lighthouses, cross-daemon Harbor Tokens, remote harbors |
| Phase 6 (Life Integration) | Connectors can run on any node | GPU-heavy connectors on gaming PC, lightweight ones on MacBook |

---

## 20. Testing Strategy

### Unit Tests

```
tests/unit/mesh/
  node-identity.test.js     # UUID generation, persistence, reload
  discovery-mdns.test.js    # mDNS advertisement/response parsing
  discovery-tailscale.test.js # Tailscale API mocking
  peers.test.js             # Peer registry CRUD
  raft.test.js              # Election, term management, vote handling
  replication.test.js       # CDC trigger generation, changelog parsing
  pubsub-bridge.test.js     # Message bridging, loop prevention
  middleware.test.js        # Operation scope routing
  write-queue.test.js       # Queue/replay during partition
```

### Integration Tests

```
tests/integration/mesh/
  two-node-discovery.test.js  # Two ephemeral daemons discover each other
  leader-election.test.js     # Election with 2 and 3 nodes
  replication.test.js         # Write on leader, verify on follower
  partition.test.js           # Simulate network partition, verify behavior
  pubsub-bridge.test.js      # Cross-node message delivery
  lock-consensus.test.js     # Distributed lock acquisition
  failover.test.js           # Leader dies, new leader elected, state preserved
```

Integration tests use ephemeral daemons (the existing `tests/helpers/ephemeral-daemon.js` pattern) with `PORT_DADDY_PREFIX` for isolation. Each test spins up 2-3 daemons on different ports.

### Chaos Tests

```bash
# Ship with the daemon — run against a live mesh
pd mesh test --chaos

# Tests:
# 1. Kill leader process, verify follower promotes
# 2. Block mesh port (iptables/pf), verify partition handling
# 3. Slow replication (tc qdisc / pfctl), verify lag detection
# 4. Concurrent lock acquisition from both nodes
# 5. Write queue replay after partition heal
```

---

## Appendix A: Why Not CRDTs?

CRDTs (Conflict-free Replicated Data Types) are an alternative to leader-based consensus. They allow concurrent writes on any node with guaranteed convergence.

**Why we chose leader-based consensus instead:**

1. **Locks are inherently non-commutative.** A lock can only be held by one owner. CRDTs cannot model mutual exclusion without additional coordination, which brings you back to consensus.

2. **SQLite is single-writer.** Even if we used CRDTs at the application layer, we'd still need to serialize writes to SQLite. The leader model aligns with SQLite's constraints.

3. **Simplicity.** Leader-forwarding is a pattern every web developer understands (it's just a reverse proxy). CRDTs require reasoning about merge functions, causality, and tombstone management.

4. **Debuggability.** With a leader, the state of the system is the leader's database. With CRDTs, the state is the merge of all replicas, which is harder to inspect.

5. **Port Daddy's scale.** CRDTs shine at thousands of nodes with high write contention. Port Daddy's mesh will have 2-10 nodes with low write volume. The complexity tax of CRDTs is not justified.

## Appendix B: Why Not LiteFS / Litestream?

LiteFS (Fly.io's distributed SQLite) and Litestream (SQLite replication to S3) are off-the-shelf solutions for SQLite replication.

**Why we build our own:**

1. **LiteFS requires FUSE.** Not available on macOS without macFUSE (which requires disabling SIP). Non-starter for the primary target platform.

2. **Litestream replicates to object storage.** It's designed for disaster recovery, not real-time multi-node reads. Replication lag is seconds to minutes.

3. **Both replicate the entire database.** We only want to replicate specific tables. Local tables (port claims, tunnels, system ports) should NOT be replicated — they're meaningless on other nodes.

4. **CDC gives us fine-grained control.** We can batch, filter, and transform replication data. We can add mesh-specific metadata (term numbers, node IDs) to the changelog.

5. **Dependency minimization.** Port Daddy's only native dependency is `better-sqlite3`. Adding LiteFS would require FUSE, a sidecar process, and a new failure mode.

## Appendix C: Sequence Diagrams

### C1. Leader Election (2 nodes)

```
  Node A (was leader)              Node B (follower)
       │                                │
       │  [Node A crashes]              │
       X                                │
                                        │
       .                    election    │
       .                    timeout     │
       .                        │       │
       .                        ▼       │
       .                   Increment    │
       .                   term=8       │
       .                        │       │
       .              ┌────────►│       │
       .              │  Can't  │       │
       .              │  reach  │       │
       .              │  Node A │       │
       .              └─────────┘       │
       .                                │
       .                   2-node mesh: │
       .                   can't get    │
       .                   majority     │
       .                        │       │
       .                   Stays        │
       .                   CANDIDATE    │
       .                   (no leader)  │
       .                        │       │
       │  [Node A restarts]     │       │
       │                        │       │
       │◄──── RequestVote(term=8) ──────│
       │                        │       │
       │──── VoteGranted(term=8) ──────►│
       │                        │       │
       │                   Node B       │
       │                   is LEADER    │
       │                   (term=8)     │
       │                        │       │
       │◄──── AppendEntries ────────────│
       │      (heartbeat)       │       │
       │                        │       │
       │  Node A is             │       │
       │  FOLLOWER              │       │
       │  (term=8)              │       │
```

### C2. Forwarded Write (Lock Acquire)

```
  Agent on Node B         Node B (follower)        Node A (leader)
       │                        │                        │
       │── POST /locks/deploy ──►                        │
       │                        │                        │
       │                 scope=consensus                 │
       │                 role=follower                   │
       │                        │                        │
       │                        │── POST /forward ──────►│
       │                        │   { method: 'POST',   │
       │                        │     path: '/locks/deploy',
       │                        │     body: { owner: 'agent-b1' } }
       │                        │                        │
       │                        │                   Execute locally
       │                        │                   locks.acquire()
       │                        │                        │
       │                        │                   CDC trigger fires
       │                        │                   mesh_changelog +=1
       │                        │                        │
       │                        │◄── 200 { acquired } ───│
       │                        │                        │
       │◄── 200 { acquired } ───│                        │
       │                        │                        │
       │                        │◄── WS: sync { changes: │
       │                        │     [lock INSERT] }    │
       │                        │                        │
       │                   Apply to                      │
       │                   local replica                 │
       │                        │                        │
       │                        │── WS: ack { seq: N } ──►
```

### C3. Partition and Heal

```
  Node A (leader)                Node B (follower)
       │                              │
       │  ──── network partition ──── │
       │  X                        X  │
       │                              │
       │  Still leader              No heartbeat
       │  (has self-vote)           from leader
       │                              │
       │  Local ops: OK            election timeout
       │  Mesh writes: OK*            │
       │  (*no replication)        Becomes CANDIDATE
       │                           term=9
       │                              │
       │                           Can't reach A
       │                           Stays CANDIDATE
       │                              │
       │  Agent writes note        Agent tries lock
       │  (works, leader)          → 503 (no leader)
       │                              │
       │                           Write queued:
       │                           mesh_write_queue
       │                              │
       │  ──── partition heals ──── │
       │                              │
       │◄── RequestVote(term=9) ──────│
       │                              │
       │  term 9 > term 8             │
       │  Steps down to FOLLOWER      │
       │                              │
       │── VoteGranted(term=9) ──────►│
       │                              │
       │                           LEADER (term=9)
       │                              │
       │                           Replay write queue
       │                              │
       │◄── full-sync-request ────────│
       │                              │
       │── full-sync-response ───────►│
       │   (Node A's changes         │
       │    during partition)         │
       │                              │
       │  [DATA MERGE]                │
       │  Node A's partition writes   │
       │  + Node B's queued writes    │
       │  = reconciled state          │
```

---

*End of architecture document. This design is implementable in TypeScript/Node.js, works on macOS and Linux, and scales from 2 nodes (MacBook + Gaming PC) to a small team (5-10 nodes) with the same codebase.*
