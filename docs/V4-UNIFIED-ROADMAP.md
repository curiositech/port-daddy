# Port Daddy V4: Unified Roadmap

**Author:** Erich Owens
**Last Updated:** March 2026
**Status:** Active — Phase 0 complete, Phase 1 in progress

This document synthesizes all V4 planning documents into a single sequenced roadmap. Nothing from the original documents has been discarded — ideas that aren't yet sequenced are preserved in the Appendix.

---

## The Thesis

Port Daddy V3 coordinates agents on your machine. Port Daddy V4 is where agents enter **binding work agreements** — declared, collateralized, settled against evidence. The Anchor Protocol is the conceptual center. Everything else — credits, memory, fleets, quality gates, the semantic graph — orbits around the idea that work should be declared, agreed upon, and settled, not just started and hoped for.

The formal foundation for this thesis is the **Bonded Commons** paper (Owens, 2026), which argues that multi-agent collaboration at scale requires a pre-transactional trust infrastructure — a commons authority — rather than peer-to-peer trust negotiation. The authority provides three layers: structural prevention (capability attenuation), immutable attribution (Merkle-chained evidence), and economic alignment (collateralized work contracts).

---

## Phase 0: Formal Foundation [COMPLETE]

*Everything built during the March 2026 sessions. This is the proven base.*

| Item | Status | Artifact |
|------|--------|----------|
| Anchor Protocol white paper | Done | `whitepaper/anchor-protocol-whitepaper.tex` (16 pages) |
| Bonded Commons white paper | Done | `whitepaper/agent-transactions-whitepaper.tex` (16 pages) |
| ProVerif models (all 3 phases) | Verified | `analyses/harbor_card_v{1,2,3}_*.pv` — all TRUE |
| ProVerif escrow secrecy model | Verified | `analyses/harbor_card_v4_escrow_secrecy.pv` — TRUE |
| Rust core (Kani-verified, FFI) | Deployed | `core/harbor-card-rs/` → `dist/core/libharbor_card_rs.dylib` |
| Arbiter (6 invariant rules) | Deployed | `lib/arbiter.ts`, `routes/arbiter.ts`, wired in `server.ts` |
| Note encryption (envelope) | Deployed | `lib/note-encryption.ts`, integrated in `lib/sessions.ts` |
| Barnacle watchdog (Rust) | Built | `dist/core/pd-barnacle` (6MB binary) |
| 10 formal skills | Built | `~/.claude/skills/{mechanism-design,tlaplus,political-philosophy,...}` |
| Stable branch workflow | Active | `~/port-daddy-stable/` worktree |
| Fleet agents | Running | 8 agents: gardener, qa, test-gap-hunter, etc. |
| 52 test suites, 3239 tests | Passing | `npm test` |

---

## Phase 1: The Semantic Graph [NEXT]

*The nervous system. Agents navigate relationships, not flat registries.*

**Why first:** Bond pricing depends on *what* the agent is touching (graph position: critical file vs. docs). The credit system needs the graph to price risk. The evaluator needs the graph to verify scope.

### 1A. Unified Edge Table

```sql
CREATE TABLE graph_edges (
  source_id  TEXT NOT NULL,  -- 'type:id' (e.g., 'agent:cli-123')
  relation   TEXT NOT NULL,  -- 'claims', 'knows', 'calls', 'contains'
  target_id  TEXT NOT NULL,  -- 'type:id' (e.g., 'symbol:handleLogin')
  metadata   TEXT,           -- JSON: line ranges, confidence, etc.
  created_at INTEGER,
  PRIMARY KEY (source_id, relation, target_id)
);
```

Migrate existing session file claims and agent skills into this table as edges.

### 1B. Recursive Token Resolver

Wildcard queries over the graph: `myapp:*` resolves all sub-tokens via `contains` edges. This replaces the current SQL LIKE pattern matching with a proper graph traversal.

### 1C. Lazy Code Promotion

`pd scan` extracts code symbols (exported functions, classes), but they only become graph nodes when an agent interacts with them. Prevents database bloat from indexing entire codebases.

### 1D. Graph-Centric Discovery

`pd discover --skill "typescript" --status "active"` — find peers by capability, not just by name. `pd discover --path "src/auth.ts"` — see all agents/sessions touching a file.

### 1E. Dashboard Graph Visualizer

Force-directed graph view in the dashboard. Heat map overlay for contested files. Relationship filtering (claims, calls, contains, knows).

**Deliverable:** Agents can declare, query, and subscribe to semantic relationships. The graph is the foundation for everything that follows.

---

## Phase 2: The Economy [REQUIRES ECONOMIST]

*Float Plans, Anchors, Credits, Quality Gates. The Bonded Commons made concrete.*

**Dependency:** The bond pricing function $\pi$ is the open problem. Erich's economist friend designs it. The infrastructure below makes the market *possible*; the pricing function makes it *fair*.

### 2A. Credit System

- Per-project credit pools (configurable initial balance)
- Agent balances persist in SQLite
- Credits are fungible compute units — not pegged to dollars yet
- Later: peg to real compute cost (Ollama tokens, Claude API spend)

### 2B. Float Plans

```
pd anchor file plan.yaml
```

Agent declares: what I'll do, what I need, what I expect, my deadlines, my contingency. Daemon validates against available resources and harbor permissions, signs the Float Plan, escrows credits.

### 2C. Anchor Tokens

Daemon-signed proof that the Float Plan is registered and credits are escrowed. The agent carries this token while working. Settlement evaluates outcome against the Float Plan's acceptance criteria.

### 2D. Quality Gates + Evaluator Agents

Evaluator agents score work against acceptance criteria. The evaluator is the oracle in the settlement process. Multi-oracle settlement (automated tests + evaluator agent + random human audit) prevents oracle manipulation.

### 2E. Settlement

```
pd done  →  daemon evaluates  →  credits released/forfeited
```

- Success: full escrow released
- Partial (crash + salvage): pro-rata based on Merkle-chained evidence trail
- Sabotage: full bond liquidated to reconstruction fund

### 2F. Experience Points & Reputation

- XP is domain-scoped: `myapp:auth:xp`, `myapp:api:xp`
- Higher-XP agents preferred for harder tasks
- Reputation as a discount on bond collateral (from the Bonded Commons paper)
- `pd spawn` uses reputation to select agent backends

### 2G. Enforced Harbors (Optional Mode)

When credits are at stake, file claims can be enforced (not just advisory). This is $I_1^+$ from the Bonded Commons paper — advisory stays the default, enforcement is opt-in for bonded work.

**Deliverable:** Agents enter binding work agreements. Work is declared, collateralized, and settled against evidence. The economy runs on internal credits with reputation-based pricing.

---

## Phase 3: Fleet & Memory

*Always-on agents, episodic memory, declarative swarm management.*

### 3A. Declarative Fleet (`.portdaddy/fleet.yaml`)

```yaml
project: myapp
agents:
  docs-updater:
    backend: ollama
    model: llama3.2:8b
    purpose: "Watch for code changes, update docs"
    trigger: pd watch myapp:code:changed
  adversarial-tester:
    backend: claude
    model: claude-haiku-4-5
    purpose: "Find edge cases in new features"
    schedule: "0 */4 * * *"
```

`pd fleet up/down/status` — like docker-compose for agent swarms.

### 3B. Episodic Memory

```
pd memory store <key> <value>
pd memory recall <query> [--limit 5]
pd memory forget <key>
pd memory episodes [--agent <id>]
```

- Persists across sessions (SQLite)
- Scoped by agent identity (wildcards)
- Semantic recall via local embeddings (Ollama)
- Auto-summarization when episode count exceeds threshold
- Now encrypted at rest (note encryption from Phase 0)

### 3C. Deep `pd scan`

- Dependency graphs between services
- Test suite detection
- Identity suggestions from directory structure
- `.env` port import
- Recursive monorepo scanning with depth control

### 3D. Dashboard Fleet Panel

Visual fleet management, watch hooks with message history, spawn agent form, fleet.yaml editor.

**Deliverable:** Agents run continuously, learn across sessions, and are managed declaratively.

---

## Phase 4: Resilience & Performance

*The kernel upgrade. Hardened for production workloads.*

### 4A. Bun/Fastify Migration

Replace Express with Fastify on Bun for 20,000+ req/sec. Single-file binary compilation via `bun build --compile`.

### 4B. Unix Domain Sockets / Named Pipes

Binary IPC (MessagePack/CBOR) for high-frequency heartbeats. Reduces HTTP overhead for local agent communication.

### 4C. Radix Trie (In-Memory Semantic Index)

Adaptive Radix Tree for sub-millisecond wildcard resolution. Harbor Bitmasks for O(1) scope filtering. SQLite as persistence/recovery only — trie is the hot path.

### 4D. Backpressure

Socket-level backpressure when SQLite WAL commits lag. Forces agents to pause rather than bloating daemon RAM.

### 4E. `pd self-test --adversarial`

Ships with the daemon. Runs the chaos test suite from V4-TEST-SUITE.md against the live instance. Outputs a "Nautical Seaworthiness Report."

### 4F. Hardened Windows IPC

Named Pipes with explicit DACLs (SDDL). `PIPE_REJECT_REMOTE_CLIENTS` to prevent NTLM relay attacks.

**Deliverable:** The daemon handles production agent fleets at scale with sub-millisecond coordination.

---

## Phase 5: The Network

*From local Leviathan to distributed commons.*

### 5A. Lighthouses (Discovery & Federation)

A lighthouse is a daemon that advertises its harbors to the network.

- **Layer 1 (Local):** mDNS/Bonjour for zero-config tandem coding on LAN
- **Layer 2 (Relay):** `lighthouse.portdaddy.dev` for remote teams
- **Layer 3 (Public):** Marketplace for GPU compute and specialist agent bidding

### 5B. Cross-Daemon Harbor Tokens

Harbor Cards valid across machines. mTLS between daemons. Trust federation via shared Lighthouse roots.

### 5C. Remote Harbors

`pd harbor connect <lighthouse-url>` — no separate "remote harbor" concept. A harbor is the unit of collaboration, local or remote.

### 5D. The Marketplace

Public task registry. Agents bid on Float Plans. 15% coordination fee on cross-harbor settlements via the managed relay. Curiositech holds the Reputation Ledger — the moat.

**Deliverable:** Agents collaborate across machines and organizations with the same trust guarantees as local coordination.

---

## Phase 6: Life Integration

*Connectors, coaching agents, the personal OS.*

### 6A. Connector Framework

Read-only integrations: Gmail, GCal, GitHub, Slack. Each connector gets a harbor token with minimal capabilities.

### 6B. Outbound Firewall

GET-only by default. POST/PUT requires human approval via the Dashboard. The Arbiter monitors connector activity.

### 6C. Coaching Agent Template

Pre-built always-on agent: daily brief, skill tracking, calendar awareness. The "killer app" for personal use.

---

## Monetization Tiers

| Tier | Price | Features |
|------|-------|----------|
| **OSS / Community** | $0 | Daemon, CLI, SDK, MCP, sessions, salvage, pub/sub, fleet (3 agents) |
| **Pro** | $29/seat/mo | Unlimited fleet, Anchor Protocol + credits, episodic memory, enforced harbors, Lighthouse Relay access |
| **Team** | $99/team/mo | Remote harbors, shared credit pools, swarm analytics, GitHub/GitLab connectors |
| **Enterprise** | $500+/mo | Self-hosted Lighthouse, SAML/SSO, air-gapped harbors, immutable audit logs |
| **Marketplace** | 15% fee | Coordination tax on cross-harbor credit settlements via managed relay |

---

## The Narrative Arc

> **V3** (now): "Port Daddy coordinates agents on your machine."
> **V4** (economy): "Port Daddy is where agents enter work agreements."
> **V5** (platform): "Port Daddy is the operating system for autonomous agent teams."

---

## Appendix: Wild Ideas & Unsequenced Concepts

*Preserved from the original planning documents. Not lost, just not yet scheduled.*

### A1. The SOMA Crossover (Bayesian Arbiter)
From `ARBITER_DESIGN.md`: The Arbiter as a biological immune system. If it senses high "anomaly pheromones" around a semantic token, it lowers its intervention threshold — adaptive scrutiny based on accumulated evidence. The Arbiter isn't static rules; it's a macrophage that learns which tokens are under attack.

### A2. Pheromone Evaporation (Stigmergic Coordination)
From `STIGMERGIC_BACKLOG.md`: Metadata traces that fade over time. Agents "spray" annotations on semantic tokens; the daemon evaporates stale annotations. High-confidence tokens (annotated by Coder + Reviewer + Tester) trigger automatic merge. Logic implemented in `lib/pheromone.ts` but no CLI commands yet. Needs `pd pheromone spray/sniff` and dashboard visualization.

### A3. Stigmergic Merging
From `WORKTREE_SWARMS.md`: Instead of human-driven merge, a "Janitor Agent" watches the token graph. When confidence_scent hits 0.95 across Coder + Reviewer + Tester annotations, it initiates `git merge` of all involved worktrees automatically. Requires the Semantic Token Graph (Phase 1) as infrastructure.

### A4. WinDAGs Bridge
From `STIGMERGIC_BACKLOG.md`: Map WinDAGs abstract nodes to Port Daddy physical Harbors. Automatically create a Harbor for every WinDAGs execution ID. Use the Arbiter to revoke Harbor Cards if WinDAGs evaluation fails.

### A5. The Worktree Reaper
From `STIGMERGIC_BACKLOG.md`: Automatically prune agent worktrees when sessions are marked completed or abandoned. `git worktree remove --force <path>`. Concurrency requires isolation, but isolation shouldn't be permanent.

### A6. Arbiter Phase 3: The Independent Agent
From `ARBITER_DESIGN.md`: Extract the Arbiter from the daemon entirely. It becomes a standalone binary (`pd arbiter start`) that runs alongside the swarm. Critical for P2P — prevents a compromised daemon from hiding its tracks. The Arbiter would subscribe to the daemon's event stream externally.

### A7. Semantic Synonym Registry
From `semantic-token-graph.md`: Agents might use different names for the same skill (`js` vs `javascript`). Lightweight local embeddings (via Ollama) normalize tokens. Prevents semantic drift in the graph.

### A8. Graph-Centric `pd watch`
From `semantic-token-graph.md`: Current `pd watch` is channel-centric. New version is graph-centric: `pd watch "symbol:processPayment:*"` — notified if any agent claims, modifies, or creates a relation to this symbol or its children.

### A9. Harbor Resource Inheritance
From `V4-HARBOR-ECONOMY.md`: A harbor declares `provides(skill:postgres)`, and all agents within it automatically gain that edge in the graph. Ambient capabilities inherited from the harbor context, not individually assigned.

### A10. Hive Mind (Collective Memory)
From `V4-HARBOR-ECONOMY.md`: Harbor-scoped collective memory using semantic embeddings. Facts discovered by one agent are available to all agents in the harbor. Per-harbor embedding store backed by Ollama.

### A11. Agent Memory Compression
From `v4_thoughts.md`: When an agent's episode count exceeds a threshold, old episodes are automatically compressed into a summary. Prevents unbounded memory growth while preserving learned knowledge.

### A12. Asciinema Demo Engine
From `STIGMERGIC_BACKLOG.md`: High-fidelity terminal demos showing multi-agent coordination. `pd demo` command with `.tape` files. Dual-theme (Light/Dark) GIF rendering for the landing page.

### A13. Homebrew Distribution
From `STIGMERGIC_BACKLOG.md`: `Formula/port-daddy.rb` already created. Needs automated SHA-256 updates in the release pipeline. Goal: `brew install erichowens/port-daddy`.

### A14. VS Code Extension
From `v4_thoughts.md`: File claims visible in the gutter. Session sidebar. Salvage alerts. Goal: daily active usage from IDE integration.

### A15. A2A Protocol Support
From `v4_thoughts.md`: Agents serve Agent Cards. Cross-tool discovery via the Google A2A protocol. Industry standard alignment for when Port Daddy agents need to talk to non-PD agents.

### A16. Formal TLA+ Model Checking
From `v4_thoughts.md`: Run TLC on the BondedCommons spec with concrete parameters. Report state space statistics. Publishable result for the papers. The `tlaplus-practitioner` skill is built and ready for this.
