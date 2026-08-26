<!-- RETIRED-BY: ADR-0126 -->
> ## ⚓ Retired — superseded, kept as history
>
> **The critical path in this document is dead as a plan.** It runs
> XVIII → I → XVII → II/III, and Part XVII (the daemon sync protocol) was
> rejected by [ADR-0049](docs/adr/0049-relay-architecture.md)'s non-goals. A
> critical path through a rejected node orders nothing.
>
> The surviving fragment is [ADR-0115](docs/adr/0115-database-distribution-and-sync.md)
> — replication classes, the sync spine, the co-signed PairingReceipt — which
> absorbed what Part XVII got right. The dependency notation and the
> per-part descriptions remain useful history; the ORDER does not.
>
> **Authority:** [ADR-0126 — Shared-Harbors Re-sequencing](docs/adr/0126-shared-harbors-resequencing.md), § Formal supersessions.
> This document is retained deliberately: the 2026-06-05 operator rule is
> demote by default, delete only a merged twin. Read it for the reasoning
> that was current when it was written, not for what to build now.

---

# Port Daddy V4: Implementation DAG

This document defines the dependency graph and implementation order for all 27 parts
of the V4 plan. Each node lists its hard prerequisites (must be complete before starting)
and soft prerequisites (should exist but can be stubbed). The critical path is highlighted.

---

## Notation

- **→** hard dependency (blocking)
- **⇢** soft dependency (can stub/skip initially)
- **[V4.0]** ships at V4.0 launch
- **[V4.1]** ships at V4.1
- **[V4.2+]** ships at V4.2 or later
- **LOE** = rough lines-of-code estimate for new/modified code

---

## Tier 0: Foundations (No V4 Dependencies)

These can start immediately and in parallel. They are prerequisites for everything else.

### Part XVIII: Key Management `[V4.0]`
**LOE:** ~400 lines (`lib/key-manager.ts` + schema migration)
**Hard deps:** None
**Produces:** HMAC signing key for harbor cards, `signing_keys` table, `revoked_jtis` table, `~/.config/port-daddy/keys/` directory
**Why first:** Part I cannot sign harbor cards without a key. Part XVII cannot authenticate WebSocket connections without Ed25519 (V4.1). This is the root of the trust chain.

### Part VII: Semantic Trie `[V4.0]`
**LOE:** ~300 lines (`lib/token-trie.ts`)
**Hard deps:** None
**Produces:** In-memory radix trie over colon-delimited identity tokens, rebuilt from SQLite on startup
**Why first:** Pure data structure with no external dependencies. Consumed by harbor middleware (Part I), MCP (Part X), pheromones (Part XV), regions (Part XIV).

### Part VI: ADRs `[V4.0]`
**LOE:** ~Documentation only (ADR-0001 through ADR-0016)
**Hard deps:** None
**Produces:** Decision records that constrain all subsequent implementation
**Why first:** ADRs are design constraints, not code. Write them as you go, but the key decisions (ADR-0003 harbor-first, ADR-0007 HLC, ADR-0010 pino) should be finalized before implementation begins.

### Part XX: Structured Logging `[V4.0]`
**LOE:** ~350 lines (`lib/logger.ts` + pino integration across modules)
**Hard deps:** None
**Produces:** `lib/logger.ts`, subsystem debug tracing, `POST /log-level`, `GET /logs` ring buffer, `X-Request-Id` propagation
**Why early:** Every subsequent module benefits from structured logging. Integrating pino early means all new code uses it from day one rather than retrofitting.

---

## Tier 1: Harbor Enforcement (The Critical Path)

### Part I: Harbor-First Architecture (Local) `[V4.0]` ★ CRITICAL PATH
**LOE:** ~600 lines (`lib/harbor-middleware.ts` + modifications to `lib/sugar.ts`, `server.ts`)
**Hard deps:** Part XVIII (need signing key for harbor cards)
**Soft deps:** Part VII (trie for capability lookups — can use SQL initially), Part XX (logging)
**Produces:** `requireHarborCard()` middleware, auto-harbor on `pd begin`, capability attenuation on `pd spawn`, grace period mode (`--enforce-harbors warn|enforce`)
**Why critical:** Every other V4 feature assumes harbor enforcement exists. The middleware is the security boundary.

### Part XXI: UX & Error Catalog `[V4.0]`
**LOE:** ~250 lines (CLI help tiers, error message format, error codes PD-E001–E013)
**Hard deps:** Part I (error codes reference harbor violations)
**Soft deps:** Part XX (structured error logging)
**Produces:** Tiered CLI help, three-part error messages (what/why/fix), `PD-E001`–`PD-E013` error codes, first-run onboarding detection
**Why here:** Error codes are referenced by Parts I, VII, VIII, XVII. Standardizing early prevents inconsistent error handling.

---

## Tier 2: Data Layer (Can Parallel with Tier 1 After XVIII)

These parts build the data structures that remote sync and advanced features need.

### Part XIII: Harbor KV `[V4.0]`
**LOE:** ~400 lines (`lib/harbor-kv.ts`, `harbor_kv` + `harbor_embeddings` tables)
**Hard deps:** Part I (KV is scoped per harbor)
**Soft deps:** Part XVII (HLC columns added later), Part XXV (CRDT modes added later)
**Produces:** Scoped mutable KV store with CAS, whiteboard abstraction (`whiteboard:` key prefix), optional embedding search (Ollama fallback to FTS5)
**Notes:** Schema must reserve HLC columns (`hlc_physical`, `hlc_counter`, `hlc_node`) even if nullable in V4.0 — avoids migration later.

### Part XV: Stigmergic Coordination (Pheromones) `[V4.0]`
**LOE:** ~500 lines (upgrade `lib/pheromone.ts`, `pheromones` table, evaporation engine)
**Hard deps:** Part I (pheromone deposition triggered by harbor-scoped operations)
**Soft deps:** Part VII (trie for pheromone path lookups), Part XVII (HLC columns nullable in V4.0)
**Produces:** 7 pheromone types, 30-second evaporation timer, automatic deposition hooks in `sessions.ts`/`agents.ts`/`locks.ts`, manual deposition API, pheromone readings injected into MCP tool responses
**Notes:** Must add deposit calls into existing modules (`sessions.ts addNote()`, `agents.ts markDead()`, `locks.ts acquire()`) — coordinate with Part XXVI hash-chained notes.

### Part XXVI: Invariants (Cross-Pollination) `[V4.0 partial, V4.1 full]`
**LOE:** ~300 lines (scattered across multiple modules)
**Hard deps:** Part VII (bitmask requires trie), Part XV (pheromone rate limiting)
**Soft deps:** Part XVIII (filesystem heartbeat watchdog)
**Produces:**
- V4.0: Hash-chained session notes (`prev_hash` in `session_notes`), harbor bitmask in `TrieNode`, 5 benchmark invariants (T1–T5), `pd self-test` basic
- V4.1: Lazy token promotion, filesystem heartbeat watchdog, two-tier scheduler, `pd self-test` adversarial

---

## Tier 3: MCP & CLI Surface

### Part X: MCP Server V4 Tools `[V4.0]`
**LOE:** ~500 lines (additions to `mcp/server.ts`)
**Hard deps:** Part I (harbor enforcement for `begin_session` returning card), harbor routes
**Soft deps:** Part XIII (harbor KV tools), Part XV (pheromone readings in responses)
**Produces:** 15 new MCP tools (8 harbor, 5 remote, 2 spawn), Essential set expanded from 8→10, harbor card stored and sent as `X-Harbor-Card`, 3 new resources (`harbors`, `peers`, `timeline`)
**Notes:** Card renewal flow (Part XXV amendment) — on 403, MCP server requests renewal via `POST /harbors/:name/renew` with expired-but-signed card.

### Part XXV: Retrospective Amendments `[V4.0]`
**LOE:** ~400 lines (amendments distributed across Parts I–XVI implementations)
**Hard deps:** Parts I, VII, X, XIII, XV (amends their implementations)
**Produces:** Harbor card renewal endpoint, grace violation counter in `pd status` + `GET /metrics`, Windows named pipe username qualification, trust tier transition behavior, region claims advisory-only, template scope cut to 2
**Notes:** Not a standalone module — these amendments should be integrated as each parent part is built. Listed here as a tracking node.

---

## Tier 4: Sync & Networking (V4.0 Foundation, V4.1 Full)

### Part XVII: Distributed State & Sync Protocol `[V4.0]` ★ CRITICAL PATH
**LOE:** ~1,500 lines (`lib/hlc.ts` ~100, `lib/sync-protocol.ts` ~800–1200, `lib/conflict-resolver.ts` ~300)
**Hard deps:** Part XVIII (Ed25519 for WebSocket auth — V4.1; HMAC for V4.0)
**Soft deps:** Part I (harbor scoping for sync), Part XIII (HLC columns in `harbor_kv`), Part XV (HLC columns in `pheromones`)
**Produces:** HLC clock, WebSocket bidirectional sync, 5-bucket Merkle hash comparison, msgpack mutation frames, LWW conflict resolution, fencing tokens for distributed locks, exponential backoff reconnection, partition detection (1 hour → reconciliation)
**Notes:** This is the most complex single module. The 5 sync categories: agents, sessions+notes, locks, pheromones, harbor_kv. Each category has its own Merkle branch.

### Part XII: Trust Tiers `[V4.0 schema, V4.1 enforcement]`
**LOE:** ~300 lines (trust tier logic in `lib/harbors.ts` or `lib/harbor-trust.ts`)
**Hard deps:** Part XVII (Merkle hash must be trust-tier-aware — hash computed only over allowed branches)
**Produces:** Three tiers (full/coordinated/minimal), per-tier data category filtering, `visibility` field on notes, signed trust tier in daemon key, Merkle branch filtering
**Notes:** Part XXVI amends this — Merkle hash must filter branches per trust tier.

### Parts II/III: Remote Harbors & Lighthouse `[V4.0 basic, V4.1 full]`
**LOE:** ~800 lines (`routes/harbors.ts` remote endpoints, lighthouse relay, mDNS/Tailscale discovery)
**Hard deps:** Part I (harbor enforcement), Part XVII (sync protocol), Part XVIII (key management)
**Soft deps:** Part XII (trust tiers for cross-daemon sync filtering)
**Produces:** `pd harbor connect`, `pd harbor create --remote`, lighthouse mode, daemon-to-daemon sync over WebSocket+TLS, mDNS discovery, Tailscale detection, Windows support (named pipes)
**Notes:** The lighthouse is just a daemon with `--lighthouse` flag that relays sync frames between peers that can't directly connect.

---

## Tier 5: Advanced Features (V4.1+)

### Part VIII: Socket Transport `[V4.1]`
**LOE:** ~600 lines (`lib/socket-transport.ts`)
**Hard deps:** Part I (harbor card verification in dispatch path)
**Produces:** Length-prefixed msgpack binary protocol over Unix domain socket, bypasses Express for local calls, HTTP retained for remote sync on TCP :9877
**Notes:** V4.0 keeps HTTP over Unix socket. V4.1 makes binary the default. Dispatch table must enumerate all existing routes.

### Part XIV: Regions `[V4.0 manual, V4.1 auto, V4.2 AST]`
**LOE:** ~400 lines V4.0 (`regions` + `region_claims` tables, `cli/commands/regions.ts`)
**Hard deps:** Part I (regions decompose into file claims)
**Soft deps:** Part VII (trie for region path matching), `lib/scan.ts` (V4.1 import graph)
**Produces:**
- V4.0: Manual region definition via glob patterns + function names
- V4.1: `pd scan --deep` auto-detection via import graph SCC analysis
- V4.2: tree-sitter AST-level function tracking

### Part XXIII: Storage Lifecycle `[V4.0 basic, V4.1 full]`
**LOE:** ~500 lines (CLI commands, auto-housekeeping, ephemeral mode, GitHub Action)
**Hard deps:** None (uses existing tables)
**Soft deps:** Part XVIII (key status in bugreport)
**Produces:** `pd db archive/prune/vacuum/backup/restore/backups/status`, auto-housekeeping on startup (>24h), `pd start --ephemeral` (in-memory DB, no launchd, 30-min auto-shutdown), `curiositech/port-daddy-action` GitHub Action

### Part IX: Dashboard `[V4.1 partial, V4.2 full]`
**LOE:** ~1,200 lines (12 Web Components in `public/dashboard/components/`)
**Hard deps:** All API endpoints (Parts I–III, XV, XVII)
**Soft deps:** Part XXIV (ADR-0016 allows multiple files in `public/`)
**Produces:** 12 panels (harbors, sessions, agents, ports, locks, radio, salvage, activity, DNS, tunnels, webhooks, config), vanilla Web Components, CSS Grid, hash-based routing, SSE live updates
**Notes:** 6 panels in V4.1, 6 in V4.2.

### Part XXVII: Anchors `[V4.1 Layer 1, V4.2 Layer 2, V4.3 Layer 3]`
**LOE:** ~600 lines V4.1 (`lib/anchors.ts`, `routes/anchors.ts`, `cli/commands/anchors.ts`)
**Hard deps:** Part I (harbors), Part XVIII (Ed25519 for receipts at V4.2)
**Soft deps:** Part XVII (remote harbors for cross-machine credits at V4.3)
**Produces:**
- V4.1: 6-state task lifecycle (OPEN→ACTIVE→COMPLETED→VERIFIED + ABANDONED/DISPUTED), file claim integration, session auto-notes, salvage integration
- V4.2: Ed25519-signed JSON receipts (`lib/receipts.ts`), `~/.port-daddy/receipts/`
- V4.3: Credit pool per harbor (`lib/credits.ts`), escrow, marketplace relay (`lib/marketplace.ts`)

---

## Tier 6: External & Documentation

### Part XI: Website V2 `[V4.0 content, V4.1 full]`
**LOE:** Website repo changes (not daemon source)
**Hard deps:** Part I, Parts II/III (content depends on harbor enforcement and remote harbors existing)
**Produces:** Revised landing page, `/compare`, `/pricing`, `/tutorials/*`, 5 blog posts, OG tags, fix hardcoded `erichowens/` GitHub URLs

### Part V: Monetization & Pricing `[V4.1]`
**LOE:** Documentation + config (`lib/config.ts` for tier enforcement)
**Hard deps:** Part I (harbor enforcement is the gating mechanism)
**Produces:** Free/Pro/Team/Enterprise tier definitions, feature gates, pricing page content

### Part XXII: Market Positioning `[V4.1]`
**LOE:** ~200 lines (telemetry in daemon, Plausible on website)
**Hard deps:** Part XXI (error codes for telemetry payload)
**Produces:** Anonymous opt-in telemetry (24-hour batched counter to Cloudflare Worker), post-install survey (shown once), `/use-cases` page, competitive positioning docs

### Part XXIV: Testing & Benchmarks `[V4.0 partial, V4.1 full]`
**LOE:** ~800 lines (simulation harness, property tests, benchmark suites)
**Hard deps:** Part XV (pheromone engine for simulation), Part VII (trie for benchmarks)
**Soft deps:** Part VIII (T5 benchmark depends on socket transport)
**Produces:** Property-based tests (6 pheromone invariants via `fast-check`), multi-agent simulation harness, 5 benchmark invariants (T1–T5) in CI with `--benchmark`, dashboard Web Components architecture (ADR-0016)

---

## Critical Path (Longest Dependency Chain)

```
Part XVIII (Key Mgmt)
    │
    ▼
Part I (Harbor Enforcement)  ◄── Part VII (Trie) [parallel]
    │                              Part XX (Logging) [parallel]
    ├──────────────────────────┐
    ▼                          ▼
Part XVII (Sync Protocol)    Part X (MCP V4 Tools)
    │                          │
    ▼                          ▼
Parts II/III (Remote)        Part XV (Pheromones)
    │
    ▼
Part XII (Trust Tiers)
    │
    ▼
Part IX (Dashboard) ← V4.1+
```

**Critical path for V4.0 launch:** XVIII → I → XVII → II/III
**Estimated LOE on critical path:** ~3,300 lines of new code

---

## Implementation Phases

### Phase A: Foundation (Build First, In Parallel)
| Part | Module | LOE | Parallelizable With |
|------|--------|-----|---------------------|
| XVIII | Key Management | ~400 | VII, VI, XX |
| VII | Semantic Trie | ~300 | XVIII, VI, XX |
| VI | ADRs | docs | XVIII, VII, XX |
| XX | Structured Logging | ~350 | XVIII, VII, VI |

**Gate:** Phase A complete when Part XVIII produces a working signing key and Part VII has a tested trie.

### Phase B: Enforcement (Harbor Middleware)
| Part | Module | LOE | Parallelizable With |
|------|--------|-----|---------------------|
| I | Harbor Middleware | ~600 | XXI (after I starts) |
| XXI | Error Catalog | ~250 | I (once error codes defined) |

**Gate:** Phase B complete when `pd begin` returns a harbor card and middleware rejects unauthenticated requests (in `enforce` mode).

### Phase C: Data & Coordination
| Part | Module | LOE | Parallelizable With |
|------|--------|-----|---------------------|
| XIII | Harbor KV | ~400 | XV, XXVI |
| XV | Pheromones | ~500 | XIII, XXVI |
| XXVI | Invariants (V4.0 subset) | ~200 | XIII, XV |
| X | MCP V4 Tools | ~500 | XIII, XV |

**Gate:** Phase C complete when harbor KV works, pheromones deposit/evaporate, and MCP tools pass harbor cards.

### Phase D: Networking
| Part | Module | LOE | Parallelizable With |
|------|--------|-----|---------------------|
| XVII | Sync Protocol | ~1,500 | — (complex, needs focus) |
| XII | Trust Tiers | ~300 | — (after XVII) |
| II/III | Remote Harbors | ~800 | XII (once XVII works) |

**Gate:** Phase D complete when two daemons sync harbor state bidirectionally with conflict resolution.

### Phase E: Polish & Ship V4.0
| Part | Module | LOE | Parallelizable With |
|------|--------|-----|---------------------|
| XXV | Amendments | ~400 | XXIII, XXIV |
| XXIII | Storage Lifecycle (basic) | ~300 | XXV, XXIV |
| XXIV | Testing (V4.0 subset) | ~400 | XXV, XXIII |
| XI | Website V2 (content) | docs | XXV, XXIII, XXIV |

**Gate:** V4.0 ships when all gates pass, `pd self-test` succeeds, and benchmarks T1–T4 hold.

### Phase F: V4.1+ (Post-Launch)
| Part | Module | LOE | Version |
|------|--------|-----|---------|
| VIII | Socket Transport | ~600 | V4.1 |
| XIV | Regions (auto) | ~300 | V4.1 |
| IX | Dashboard (6 panels) | ~600 | V4.1 |
| XXVII | Anchors Layer 1 | ~600 | V4.1 |
| V | Monetization | config | V4.1 |
| XXII | Telemetry | ~200 | V4.1 |
| IX | Dashboard (6 more) | ~600 | V4.2 |
| XXVII | Anchors Layer 2+3 | ~800 | V4.2–V4.3 |

---

## Dependency Matrix (Adjacency List)

```
XVIII  → []                          # no deps — start immediately
VII    → []                          # no deps — start immediately
VI     → []                          # no deps — start immediately
XX     → []                          # no deps — start immediately
I      → [XVIII]                     # needs signing key
XXI    → [I]                         # error codes reference harbor violations
XIII   → [I]                         # KV scoped per harbor
XV     → [I]                         # deposition triggered by harbor ops
XXVI   → [VII, XV]                   # bitmask needs trie, rate limit needs pheromones
X      → [I]                         # harbor card in begin_session
XXV    → [I, VII, X, XIII, XV]       # amends all of these
XVII   → [XVIII]                     # WebSocket auth needs keys
XII    → [XVII]                      # Merkle filtering needs sync protocol
II/III → [I, XVII, XVIII]            # remote harbors need enforcement + sync + keys
XXIII  → []                          # uses existing tables (soft dep on XVIII for bugreport)
XXIV   → [XV, VII]                   # simulation needs pheromones, benchmarks need trie
VIII   → [I]                         # dispatch needs harbor card verification
XIV    → [I]                         # regions decompose into file claims
IX     → [I, II/III, XV, XVII]       # dashboard needs all APIs
XXVII  → [I, XVIII]                  # anchors need harbors + keys (V4.2 for receipts)
XI     → [I, II/III]                 # website content needs features to exist
V      → [I]                         # monetization gates on harbor enforcement
XXII   → [XXI]                       # telemetry uses error codes
```

---

## Sub-DAGs for Complex Nodes

Three nodes have enough internal complexity and strict sub-task ordering to warrant
their own dependency graphs. Other large nodes (X, IX, XXIV) are internally flat —
they decompose into independent parallel work items, not ordered sub-tasks.

### Part I Sub-DAG: Harbor Enforcement

```
I.1  Load signing key from Part XVIII
      │
      ▼
I.2  Middleware skeleton (requireHarborCard function)
      │  - Parse X-Harbor-Card header / query param
      │  - Verify signature via harbor-tokens.ts
      │  - Attach payload to req.harborCard
      │  - Public route allowlist (health, version, config, GET /harbors)
      │
      ├──────────────────────┐
      ▼                      ▼
I.3  Route capability map   I.4  Auto-harbor on pd begin
      │  POST /claim/* →       │  Modify sugar.ts begin():
      │    ports:claim          │    1. Extract project from identity
      │  POST /sessions/*/     │    2. Create harbor if not exists
      │    notes → notes:write  │    3. Enter harbor, get card
      │  POST /msg/* →         │    4. Return card in response
      │    msg:publish          │
      │  POST /locks/* →       │
      │    locks:acquire        │
      │  (enumerate all        │
      │   routes)              │
      │                        │
      └──────────┬─────────────┘
                 │
                 ▼
I.5  Capability attenuation on pd spawn
      │  Parent card cap: ['*']
      │  Child card cap: subset specified by parent
      │  HMAC binds caps to token
      │
      ▼
I.6  Grace period mode
      │  --enforce-harbors warn (V4.0 default)
      │  --enforce-harbors enforce (V4.1 default)
      │  Violation counter in pd status + GET /metrics
      │
      ▼
I.7  Card renewal endpoint (Part XXV amendment)
       POST /harbors/:name/renew
       Accepts expired-but-signed card as proof of identity
```

**Internal critical path:** I.1 → I.2 → I.3 + I.4 (parallel) → I.5 → I.6 → I.7
**First shippable milestone:** I.1–I.4 (middleware + auto-harbor) — enough for all downstream consumers.

---

### Part XVII Sub-DAG: Distributed State & Sync Protocol

```
XVII.1  Hybrid Logical Clock (lib/hlc.ts, ~100 lines)
         │  - HLC struct: { physical: bigint, counter: number, nodeId: string }
         │  - send(): increment counter
         │  - recv(remote): merge, take max
         │  - compare(): total order
         │  - Unit tests: clock skew, merge commutativity
         │
         ▼
XVII.2  Merkle hash buckets (in lib/sync-protocol.ts)
         │  - 5 categories: agents, sessions+notes, locks, pheromones, harbor_kv
         │  - Per-category hash = SHA256 of sorted (key, hlc) pairs
         │  - Root hash = SHA256 of 5 category hashes
         │  - Incremental update on every write
         │  - Unit tests: hash consistency, incremental vs full recompute
         │
         ├──────────────────────────┐
         ▼                          ▼
XVII.3  WebSocket transport        XVII.4  Conflict resolver
         │  - WS /harbor/:name/      │  (lib/conflict-resolver.ts, ~300 lines)
         │    sync endpoint           │  - LWW by HLC for KV, pheromones, agents
         │  - Auth: harbor card       │  - Session merge: union notes, latest status
         │    on HTTP upgrade         │  - Lock conflict: fencing token comparison
         │  - msgpack frame codec     │  - Counter CRDT (Part XXV G-Counter)
         │  - Reconnect with          │  - Log CRDT (Part XXV G-Set)
         │    exponential backoff     │  - Unit tests: all conflict scenarios
         │  - Keepalive ping/pong     │
         │                            │
         └──────────┬─────────────────┘
                    │
                    ▼
XVII.5  Sync state machine
         │  States: CONNECTING → HASH_EXCHANGE → DIFF → STREAMING → IDLE
         │  1. Exchange root hashes
         │  2. If mismatch: exchange per-category hashes
         │  3. For mismatched categories: send all entries (V4.0 — full dump)
         │  4. Apply conflict resolver to incoming entries
         │  5. Transition to STREAMING: incremental mutation frames
         │
         ▼
XVII.6  Partition detection & reconciliation
         │  - No pong for 1 hour → partition detected
         │  - On reconnect: full Merkle re-exchange (back to HASH_EXCHANGE)
         │  - Fencing tokens for distributed locks:
         │    lock holder across partition gets lower-fenced token
         │    on healing, higher-fenced token wins
         │
         ▼
XVII.7  Trust-tier filtering (Part XII integration)
         │  - Merkle hash computed only over branches allowed by peer's trust tier
         │  - Full tier: all 5 categories
         │  - Coordinated tier: agents, sessions, locks (no KV, no pheromones)
         │  - Minimal tier: agents only
         │
         ▼
XVII.8  Integration tests
           - Two in-process daemons syncing
           - Partition simulation (drop WS, wait, reconnect)
           - Conflict resolution with concurrent writes
           - Trust tier filtering verification
```

**Internal critical path:** XVII.1 → XVII.2 → XVII.3 + XVII.4 (parallel) → XVII.5 → XVII.6
**First shippable milestone:** XVII.1–XVII.2 (HLC + Merkle) — independently testable, no networking.
**Second milestone:** XVII.1–XVII.5 (full sync without partition handling).

---

### Parts II/III Sub-DAG: Remote Harbors & Lighthouse

```
II.1  Harbor remote schema
       │  Add columns to harbors table: is_remote, listen_addr, peer_token
       │  New table: harbor_peers (harbor_id, peer_addr, peer_pubkey, connected_at)
       │
       ▼
II.2  pd harbor create --remote --listen
       │  Opens TCP listener on specified addr (default 0.0.0.0:9877)
       │  Generates peer token (JWT with harbor name + HMAC)
       │  Serves only sync endpoints on this port (not full Express app)
       │
       ├──────────────────────┐
       ▼                      ▼
II.3  pd harbor connect      II.4  Discovery mechanisms
       │  --peer <addr>         │  - mDNS advertisement (opt-in)
       │  --token <jwt>         │  - mDNS listener for auto-discovery
       │  Verifies token →      │  - Tailscale detection (check tailscale0 interface)
       │  initiates WS to       │  - Three-tier privacy: opt-in / hashed names / silent
       │  /harbor/:name/sync    │
       │  Stores peer in        │
       │  harbor_peers table    │
       │                        │
       └──────────┬─────────────┘
                  │
                  ▼
II.5  Bidirectional sync channel (uses Part XVII)
       │  WS connection established by II.3
       │  Sync state machine from XVII.5 handles the rest
       │  Data flows: file claims, sessions, notes, agent liveness, locks, pub/sub
       │
       ▼
II.6  Lighthouse mode
       │  pd start --lighthouse
       │  A daemon that:
       │    - Accepts connections from multiple peers
       │    - Relays sync frames between peers that can't directly connect
       │    - Does NOT hold its own state (pass-through only)
       │    - Useful for NAT traversal without Tailscale
       │
       ▼
II.7  CLI & MCP surface
       │  pd harbor list --remote → shows peers + connection status
       │  pd harbor disconnect <peer>
       │  5 MCP remote tools (from Part X): harbor_connect, harbor_disconnect,
       │    harbor_peers, harbor_sync_status, harbor_promote_lighthouse
       │
       ▼
II.8  Windows support
         Named pipes instead of Unix sockets for local transport
         Username-qualified pipe names: \\.\pipe\port-daddy-<username>
         Overlapped I/O for async reads (Part XXV amendment)
```

**Internal critical path:** II.1 → II.2 → II.3 → II.5 → II.6
**First shippable milestone:** II.1–II.3 + II.5 (manual `pd harbor connect` with working sync).
**Discovery (II.4) and lighthouse (II.6) are independently parallelizable after II.2.**

---

### Why Other Large Nodes Don't Need Sub-DAGs

| Node | Size | Why flat |
|------|------|----------|
| **Part X (MCP)** | 15 tools | Each tool is independent. The only ordering: store harbor card first (1 task), then add tools in any order. |
| **Part IX (Dashboard)** | 12 panels | Each Web Component is independent. Shared infra (SSE connection, CSS, router) is one task; then 12 parallel panel implementations. |
| **Part XV (Pheromones)** | ~500 LOE | Linear pipeline: schema → engine → hooks → API → MCP injection. No branching. Sequential, not a DAG. |
| **Part XVIII (Key Mgmt)** | ~400 LOE | Linear: directory setup → key generation → HMAC loading → rotation → JTI revocation. Sequential. |
| **Part XXIV (Testing)** | ~800 LOE | 3 independent workstreams (property tests, benchmarks, simulation) — parallelizable but no ordering constraints between them. |

---

## Part XXVIII: Harbor Gap Analysis (12 Gaps)

See `PLAN.md` Part XXVIII for full analysis. Summary of new nodes:

```
XXVIII.1  Harbor File Protocol (HFP)    ~600 LOE  [V4.1]  → [XVII, I, XII]
XXVIII.2  Departure Protocol            ~400 LOE  [V4.1]  → [XVII, XXVIII.1]
XXVIII.3  Harbor Tunnel Propagation     ~300 LOE  [V4.1]  → [XVII]
XXVIII.4  Cross-Peer Salvage            ~200 LOE  [V4.1]  → [XVII, XXVII]
XXVIII.5  Resilience Tiers (Relay)      ~400 LOE  [V4.2]  → [XVII, III]
XXVIII.6  harbor.json Spec              ~200 LOE  [V4.0]  → [I]
XXVIII.7  Co-op Governance              ~300 LOE  [V4.2]  → [XVII, XXVIII.6]
XXVIII.8  Awareness Layer               ~300 LOE  [V4.1]  → [XV, XVII, XXVII]
XXVIII.9  Multi-Harbor Membership       ~200 LOE  [V4.1]  → [I]
XXVIII.10 Origin Tagging                ~150 LOE  [V4.0]  → [XVII]
XXVIII.11 Resource Quotas               ~200 LOE  [V4.1]  → [XVII]
XXVIII.12 Naming Clarification          ~50 LOE   [V4.0]  → []
```

Critical path additions: XVII → XXVIII.1 (HFP) → XXVIII.2 (Departure)
New total LOE: ~3,300 additional lines.

---

## Risk Nodes

These parts have the highest risk of schedule slip or design iteration:

1. **Part XVII (Sync Protocol)** — Largest single module (~1,500 LOE), distributed systems complexity, conflict resolution edge cases. Mitigate: build HLC and Merkle comparison first as independently testable units.

2. **Part I (Harbor Middleware)** — Touches every route. Grace period mode reduces risk but the capability check mapping (which routes need which caps) requires careful enumeration. Mitigate: start with `*` cap only, add fine-grained caps incrementally.

3. **Part VIII (Socket Transport)** — Requires enumerating every Express route into a dispatch table. Platform-specific (Unix socket vs Windows named pipe). Mitigate: defer to V4.1, keep HTTP for V4.0.

4. **Part XV (Pheromones)** — Requires hooks in multiple existing modules (`sessions.ts`, `agents.ts`, `locks.ts`). Evaporation timing in tests is fragile. Mitigate: use injectable clock for testing.

5. **Part XIII (Harbor KV) embedding search** — Depends on optional Ollama backend. Behavior when no backend available is underspecified. Mitigate: ship FTS5-only in V4.0, add embedding in V4.1.
