# Port Daddy V4: Unified Roadmap

Canonical note: this file remains valuable historical context, but the active recovery authority now lives in `docs/recovery/README.md` and `docs/recovery/UNIFIED-ROADMAP.md`.

**Author:** Erich Owens
**Last Updated:** 2026-04-05
**Status:** Active — Phase 0 complete, Phase 4 partially complete (Fastify ✅, Trie ✅, Binary IPC ✅, Backpressure ⚡, Bun binary ⚡), Phase 3 largely done (fleet, pheromone, Fleet Live Dashboard all shipped). **Recovery Track 1 CLOSED** (`8744e14`, 2026-04-06) — `cost-tracker`, `counters`, and the full `/metrics/*` observability surface are now committed and released as v3.8.3. The observability trifecta is complete. FleetBar unified with the real fleet control plane (`a41f18f`, `e82f096`) — the menu bar app now shells `fleet-config-ui` via WebView instead of maintaining a shadow dashboard. Fleet runtime readiness checks, backend fallbacks, and spawn preflight enforcement committed (`3b818d2`, `71fc446`, `0cc5e6`). ~16 untracked + ~34 modified/deleted files remain uncommitted (down from 76). HEAD: `e82f096`.

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

## Phase 1: The Semantic Graph [NEXT — NO COMMITS YET, SOME STUBS BUILT]

> **Cartographer — 2026-03-31:** Three sub-modules that belong in Phase 1 were built in the 2026-03-30 session as parallel agent output: `lib/symbol-index.ts` (tree-sitter WASM, symbol extraction, dependency tracking, conflict prediction — maps to 1C), `lib/orchestrator-plugins.ts` (plugin registry + default FIFO orchestrator — adjacent to 1D), and `lib/merge-queue.ts` + `routes/merge-queue.ts` (11 endpoints, maps to Appendix A3 Stigmergic Merging). All three are built but **not yet wired into server.ts**. They sit in the filesystem waiting for the graph proper to land. Next step per CLAUDE.md: wire tree-sitter first, then merge queue. These are not "done" — they're stubs that need the unified edge table (1A) to be useful.
>
> **Cartographer — 2026-04-05 (late):** A 453-line test suite (`tests/unit/semantic-index.test.js`) now exists for the symbol index — uncommitted but present. The symbol index, orchestrator registry, and merge queue are all imported and initialized in `server.ts` (committed in `0ae2df6` on 2026-03-30). What's still missing: the `graph_edges` table (1A) that would unify these modules. **The stubs are now 6 days old with zero commits advancing them.** The `features.manifest.json` diff (uncommitted) adds an `orchestrator_plugins` entry — someone touched the manifest but not the code. The 2-week stale threshold is **2026-04-13**. At current trajectory (zero Phase 1 commits since Mar 30), these ~2500 lines cross into stale territory in 8 days. The `graph_edges` migration remains a 1-hour task blocking activation of all three modules.
>
> **Cartographer — 2026-04-06:** **7 days with zero Phase 1 commits. 7 days to stale threshold (2026-04-13).** No new Phase 1 work in the latest 7-commit burst — all energy went to Track 1 closure, FleetBar unification, and fleet runtime hardening. The symbol-index test suite and `features.manifest.json` orchestrator entry remain uncommitted. Risk is unchanged but closer: the wired-but-inactive modules are accumulating staleness while surrounding code evolves. Every commit to `server.ts` and `routes/index.ts` (both modified in this burst) increases the probability of merge friction when these modules finally activate.

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

## Phase 2: The Economy [REQUIRES ECONOMIST — FIRST INFRASTRUCTURE COMMITTED]

> **Cartographer — 2026-04-05:** The cost-tracker landed (`0169b17`). `lib/cost-tracker.ts` (319 lines): per-spawn LLM cost recording with model pricing tables, project-scoped budget checks, burn rate tracking. `routes/observability.ts` (162 lines): 6 Fastify endpoints — `/metrics/golden` (RED signals), `/metrics/cost`, `/metrics/cost/recent`, `/metrics/cost/budget/:project`, `/metrics/counters`, `/metrics/counters/top`. `tests/unit/cost-tracker.test.js` (165 lines). Fleet engine gained budget integration — `budget_usd_per_day` in `pd-fleet.yml` now enforced at spawn time. CLAUDE.md, README, SKILL.md, and API reference all updated in the same commit. **This is the first concrete Phase 2 code to ship.** It's accounting infrastructure, not the economy itself — but the economy needs accounting.
>
> **Cartographer — 2026-04-06:** `lib/counters.ts` committed in `8744e14` — the **observability trifecta is now complete** (cost-tracker + counters + observability routes). All `/metrics/*` endpoints are populated with real data. FleetBar's CostDashboard + CostStore are wired to these endpoints (committed in `a41f18f`). Fleet budget gates now actively stop spawns when `budget_usd_per_day` is exceeded. Spawn preflight enforcement (`3b818d2`, `71fc446`) requires positive budget ceiling + semantic identity before any agent launch. **Recovery Track 1 is closed.** The accounting infrastructure is production-ready. The pricing function π still requires the economist — but there's now a full cost data pipeline to calibrate against. Thomas Youle (Indiana U) proposed insurer-agent auction 2026-03-30 — no follow-up in 7 days. Unblocked path: ship real cost data to Youle.

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

## Phase 3: Fleet & Memory [MOSTLY DONE — 3B and 3C outstanding]

*Always-on agents, episodic memory, declarative swarm management.*

### 3A. Declarative Fleet (`.portdaddy/fleet.yaml`) [SHIPPED 2026-03-27, EXTENDED 2026-03-29/30]

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

> **Cartographer — 2026-03-27:** Fleet engine shipped. `lib/fleet-engine.ts` reads a YAML file and drives agents via `pd spawn`. Port Daddy dogfoods this with its own `pd-fleet.yml` declaring 7 agents: gardener (schedule), qa / test-hunter / documentarian / simplifier / cartographer (trigger: git:committed), and spark (schedule, singleton). Backends `claude-cli` and `custom` both working. Schedule and trigger dispatch both working after first real QA agent run (`cc10bfd`). Convention is top-level `pd-fleet.yml` for now; project-level `.portdaddy/fleet.yaml` path not yet established.
>
> **Cartographer — 2026-03-31:** Fleet extended significantly. `pd fleet init` added (`91c40af`) — creates a starter fleet YAML for any project. Drop-in fleet templates shipped (`1e70137`) — pre-built templates (docs watcher, adversarial tester, etc.) via `website-v2/src/pages/tutorials/Fleet.tsx`. **Auto-respawn** added (`26c4ed2`) — fleet agents restart automatically on crash; singleton mode enforced at fleet level. Fleet tutorial live on website (7 sections). Git post-commit hook (`dd820c6`) publishes commit metadata to `git:committed` channel — fleet agents trigger automatically. QA agent rules generalized to be framework-agnostic (Jest/Vitest/pytest/Go) and anti-tautology rules added. Core is complete; `.portdaddy/fleet.yaml` convention still not formalized.

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

### 3D. Dashboard Fleet Panel [SHIPPED 2026-03-27, STANDALONE]

Visual fleet management, watch hooks with message history, spawn agent form, fleet.yaml editor.

> **Cartographer — 2026-03-31:** A standalone Fleet Live Dashboard shipped (`public/fleet-live.html`, 1322 lines) — not a panel in the main dashboard but a separate monitoring page. Features: fetches from 6 daemon endpoints, unified feed with time-period grouping, agent ribbon with clickable filters, expandable notes, SSE live updates. A matching macOS menu-bar app (`fleet-live-app/`, SwiftUI + WKWebView) wraps it as a native menu-bar popover. The roadmap item envisioned a panel inside the main dashboard (with fleet.yaml editor) — that hasn't happened. The standalone page covers monitoring; editing and spawn form remain unbuilt.
>
> **Cartographer — 2026-04-05:** A full **Fleet Config UI** React app is in progress (uncommitted) at `fleet-config-ui/` with 8 components: AgentCard, AgentConfigPanel, FlowGraph, YAMLEditor, SortiePanel, DMPanel, ChannelLog, ProjectPicker. This goes well beyond the roadmap's "panel" — it's a standalone fleet management application with visual agent configuration, flow visualization, and YAML editing. Also: FleetBar macOS app (`6c6d56a`) gained enhancements, and a CostDashboard + CostStore are in progress (uncommitted) in `apps/FleetBar/`.
>
> **Cartographer — 2026-04-06:** FleetBar unified with fleet-config-ui (`a41f18f`). The menu bar app now shells the real `/fleet-ui/` web surface via WKWebView `FleetControlCenter` instead of maintaining a separate native dashboard. This is the correct architecture — one fleet UI served from the daemon, consumed by both browser and native app. Control plane entrypoints hardened in `e82f096`. Fleet Config UI components (6 files) still being actively refactored (uncommitted). The fleet-config-ui backend endpoints (`GET/PUT /fleet/config/:project`, `GET /fleet/prompt`, `GET /fleet/models`) are committed in `8744e14`. **3D is evolving from "dashboard panel" into a full fleet management product spanning daemon, browser, and native menu bar.** 3B (episodic memory) and 3C (deep scan) remain untouched.
>
> **Cartographer — 2026-04-05 (update):** The Fleet Config UI now has a backend. Uncommitted changes to `routes/fleet.ts` add 4 new endpoints: `GET /fleet/config/:project`, `PUT /fleet/config/:project`, `GET /fleet/prompt` (shell integration), `GET /fleet/models` (backend catalog). These are wired through `routes/index.ts` and registered in `features.manifest.json`. The fleet-config-ui itself is being actively refactored — `AgentRadioCard` → `AgentCard`, `ChannelFlowGraph` → `FlowGraph` (component renames in uncommitted changes, net -554 lines from the React app — slimming down). The full loop — read config → edit in UI → write back → fleet reloads — is achievable once committed.

**Deliverable:** Agents run continuously, learn across sessions, and are managed declaratively.

---

## Phase 4: Resilience & Performance [PARTIALLY SHIPPED — 4B/4C complete, 4A half (Fastify ✅, Bun ⚡), 4D half (IPC ✅), 4E/4F remain]

> **Cartographer — 2026-03-31:** Phase 4 went from 0% to ~70% complete in a 3-day burst (2026-03-29 to 2026-03-30). The Fastify migration, Radix Trie, Binary IPC, and IPC backpressure all shipped. This is now the most recently active phase. What remains: `pd self-test --adversarial` (4E) and Windows Named Pipe hardening (4F). Neither has any commits.

*The kernel upgrade. Hardened for production workloads.*

### 4A. Bun/Fastify Migration [FASTIFY SHIPPED v3.8.1, BUN BINARY IN PROGRESS]

Replace Express with Fastify on Bun for 20,000+ req/sec. Single-file binary compilation via `bun build --compile`.

> **Cartographer — 2026-03-31:** Fastify migration complete (`b8a8ae0`, 2026-03-29). All 23 route files converted to Fastify plugins. `express`, `cors`, `express-rate-limit`, `supertest` removed. Same API surface, same endpoints. BigInt serialization fixed, ephemeral port exhaustion eliminated with `fastify.inject()`. **Bun** (single-file binary) has zero commits — this half of 4A is not started.
>
> **Cartographer — 2026-04-05:** Bun binary work started. `6a8c8bb` (2026-04-01) added `build:bin` scripts and GitHub Actions workflow for binary releases. Maritime guard fix for Bun compatibility. `db4c315` includes "Bun prep" alongside CLI aliases. This half of 4A is now **in progress** — build scripts and CI exist, but no confirmed working single-file binary distribution yet.

### 4B. Unix Domain Sockets / Named Pipes [COMPLETE v3.8.2]

Binary IPC (MessagePack/CBOR) for high-frequency heartbeats. Reduces HTTP overhead for local agent communication.

> **Cartographer — 2026-03-31:** Shipped across 6 commits on 2026-03-30 (`73447b9` through `962222d`). IPC server + client (Wave 1), router + auth (Wave 2), wired into server.ts (Wave 3), SDK heartbeat fast-path (Wave 4), pheromone spray + pub/sub publish over IPC, pub/sub subscriptions with dead-man cleanup. 7-byte MessagePack header, 70-80% bandwidth reduction vs HTTP JSON. 13 FIPA performatives. ~3µs fire-and-forget vs ~200µs HTTP. Security hardened: rate limiting (500 frames/sec/conn), connection limit (256), 3-strike violation budget, TOCTOU socket fix, connect timeout, socket path length validation. 20 failure modes documented in ADR 0020. Lock release on IPC disconnect (faster than heartbeat TTL). **Complete as specified.**

### 4C. Radix Trie (In-Memory Semantic Index) [COMPLETE v3.8.0–3.8.1]

Adaptive Radix Tree for sub-millisecond wildcard resolution. Harbor Bitmasks for O(1) scope filtering. SQLite as persistence/recovery only — trie is the hot path.

> **Cartographer — 2026-03-31:** `lib/trie.ts` shipped in 3.8.0 with 26 tests, 10k entries in <10ms. `lib/semantic-index.ts` populates trie from SQLite on startup (services, agents, sessions, harbors). In 3.8.1: trie-accelerated wildcard lookups in `services.ts` and `agents.ts` (replaces SQL `LIKE` scans), 1:N support via `entryId` (40 total trie tests), trie sync on agent/session lifecycle events. Harbor bitmask filtering implemented. **Complete as specified.**

### 4D. Backpressure [IPC-LEVEL DONE v3.8.2, HTTP-LEVEL NOT STARTED]

Socket-level backpressure when SQLite WAL commits lag. Forces agents to pause rather than bloating daemon RAM.

> **Cartographer — 2026-03-31:** IPC write-queue + drain event backpressure shipped (`3b81580`). When write queue exceeds threshold, new writes pause until the socket drains — this prevents agent output from bloating daemon RAM when the client is slow. The roadmap item specified "SQLite WAL commits lag" as the trigger — that specific coupling is not yet implemented. HTTP-level backpressure has zero commits. Partial credit: the IPC path (which is the hot path for high-frequency agents) is protected.

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

### A2. Pheromone Evaporation (Stigmergic Coordination) [SHIPPED 2026-03-27, DASHBOARD VIZ DONE v3.8.0]
From `STIGMERGIC_BACKLOG.md`: Metadata traces that fade over time. Agents "spray" annotations on semantic tokens; the daemon evaporates stale annotations. High-confidence tokens (annotated by Coder + Reviewer + Tester) trigger automatic merge. Logic implemented in `lib/pheromone.ts` but no CLI commands yet. Needs `pd pheromone spray/sniff` and dashboard visualization.

> **Cartographer — 2026-03-27:** `pd pheromone spray/sniff/list` CLI commands shipped (`2b4339e`). Read-time decay (evaporation on read) shipped (`a8f3710`). File heat map via `GET /pheromone/files` shipped (`a930413`) — shows which files have the most session claim activity. **Remaining:** Dashboard visualization panel. This has graduated from "idea" to "mostly working feature" — only dashboard viz stands between it and full completion. Consider elevating to a named Phase 3E.
>
> **Cartographer — 2026-03-31:** Dashboard visualization is **done**. The pheromone file heat map on the overview panel shipped in 3.8.0 — color-coded with CONFLICT badges per file. Additionally, pheromone spray and pub/sub publish now route over the binary IPC fast path (3.8.2). Also in 3.8.2: pheromone IPC path (spray + sniff) wired into SDK fast paths. **This appendix item is now fully complete.** The only remaining open question is whether auto-merge at 0.95 confidence scent (the full A3 vision) gets built — that requires Phase 1 graph infrastructure.

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
From `STIGMERGIC_BACKLOG.md`: `Formula/port-daddy.rb` already created. Needs automated SHA-256 updates in the release pipeline. Goal: `brew install curiositech/tap/port-daddy`.

### A14. VS Code Extension
From `v4_thoughts.md`: File claims visible in the gutter. Session sidebar. Salvage alerts. Goal: daily active usage from IDE integration.

### A15. A2A Protocol Support
From `v4_thoughts.md`: Agents serve Agent Cards. Cross-tool discovery via the Google A2A protocol. Industry standard alignment for when Port Daddy agents need to talk to non-PD agents.

### A16. Formal TLA+ Model Checking
From `v4_thoughts.md`: Run TLC on the BondedCommons spec with concrete parameters. Report state space statistics. Publishable result for the papers. The `tlaplus-practitioner` skill is built and ready for this.

---

## Unplanned Work (Signal — Where Energy Actually Went)

*Items that shipped but weren't in the roadmap. Not a complaint — this is useful signal about what felt urgent vs. what was planned.*

| Shipped | Commit | Why It Happened |
|---------|--------|-----------------|
| `pd dev start/stop/status` — isolated dev daemon alongside stable | `790cdb2`, `3164375` | Needed to iterate without breaking the running stable daemon. Dev workflow gap exposed by the stable branch model. |
| Security audit — 4 CRITICAL/HIGH/MEDIUM/LOW RCE fixes | `433d3eb`, `871a559`, `52b13d7`, `ff191b1` | Security audit found command injection in spawner, DNS rebinding, path traversal, and shell injection. Urgent. |
| Website neumorphic design system overhaul | many commits 2026-03-25–26 | Design debt. The website had fictional content and inconsistent styling. Full CVA token system + Harbor Heritage palette. |
| Spark fleet agent (idea engine) | `6a68547`, fleet YAML | Emerged from the fleet work. Spark runs every 30 min, generates ideas, publishes to `spark:idea` channel. |
| Cartographer fleet agent (this agent) | `a930413`, `a8f3710`, fleet YAML | Emerged from needing automated roadmap tracking. The agent writes this file. |
| Tuple Space (`lib/tuples.ts`) — Linda-style shared coordination | `8cfce3f`, `305e063`, `f6acdbf` | Emerged from fleet coordination needs. Gives agents a shared scratchpad: `out/rd/take` with wildcard pattern matching, harbor scoping, TTL. 24 unit tests. Fully wired: CLI, SDK, MCP, completions. Not in any phase — new primitive. |
| 7 Magic MCP Tools (vibe coder suite) | `26c4ed2` | `fleet_init`, `fleet_status`, `swarm_awareness`, `catch_me_up`, `acquire_lock`, `add_note`, `pd_discover`. UX-driven: one-call answers to "what's happening here?" Emerged from dogfooding the MCP during fleet work. |
| Auto-respawn for fleet agents | `1081e65` | Fleet agents were dying silently. Auto-respawn in `fleet-engine.ts` restarts crashed agents; singleton mode prevents duplicate spawns. Not planned — discovered from operating the fleet. |
| Security audit continued (webhook secrets, file permissions, dotenv pinning) | `f91195e`, `d466103`, `f6b27b7` | Follow-on from March 2026 audit. Webhook secrets encrypted at rest, runtime files migrated from `/tmp/` to `~/.port-daddy/` (world-readable → user-only), dotenv paths pinned to prevent traversal. Driven by security debt backlog, not feature work. |
| Website overhaul Phase 2 (content truth audit + A11y + UX compression) | many commits 2026-03-29–30 | 23 false claims removed, 38 CLI syntax fixes, WCAG AA contrast, responsive padding, 55 raw code blocks unified into `CodeBlock` component, all 40+ pages compressed. Driven by website content being fictional/misleading. |
| **Orchestrator plugins + Merge queue + Symbol index stubs** — built but not wired | `7b46248` | Built as parallel agent output 2026-03-30. `lib/orchestrator-plugins.ts` (plugin registry + default FIFO), `lib/merge-queue.ts` + `routes/merge-queue.ts` (11 endpoints), `lib/symbol-index.ts` (tree-sitter WASM). None wired into server.ts. These stub out Phase 1 (symbol index → 1C) and Appendix A3 (merge queue → stigmergic merging). Energy signal: the 2026-03-30 session prioritized building these foundations even before Phase 1 formally started. |
| **OpenAPI 3.1 specification** (`docs/openapi.yaml`) — 96 paths, 125 operations | listed in [Unreleased] | Single source of truth for the HTTP API. Not in any roadmap phase. Emerged from SDK documentation maintenance. |
| **Drop-in fleet templates + `pd fleet init`** | `1e70137`, `91c40af` | Pre-built fleet YAML templates for any project type. `pd fleet init` creates a starter fleet. Not in the original 3A spec — emerged from making fleet approachable for projects that aren't Port Daddy itself. |
| **VHS CI demo workflow** (`.github/workflows/`) | `d85e30d` | Automated terminal recording with VHS + ffmpeg + daemon startup. Not in roadmap. Closest roadmap item is Appendix A12 (Asciinema Demo Engine) — different toolchain, same intent. |
| **`pd mcp install` + `pd init`** — onboarding CLI commands | `370d775` | 21 unit tests. `pd init` scaffolds a project for PD coordination; `pd mcp install` adds PD to Claude Code's MCP config. Distribution/onboarding — adjacent to A13 but broader. |
| **Blog content engine + 3 articles** | `966313d`, `9cee0e2` | Maritime signal flag SVG components. Blog article redesign with directive system. Content marketing — no roadmap phase. |
| **Curiositech rebranding** | `2a4fc5f` | MCP skill discovery, brand rename. Marketing/identity work. |
| **Website overhaul Phase 3** (tutorials, hero, install CTA, navigation) | `c1fbbc9`, `ff8b56f`, `78ec0a6`, `d250215`, many more | 19 tutorials repaired, new 4-tab install CTA with typewriter animation, hero feature grid hoist, Home link added. Continued content truthing (`c9be89d` — 10 factual errors fixed). Energy still flowing to website despite no roadmap phase for it. |
| **VHS demo GIFs for blog** | `f88d04e` | 5 recorded GIFs for blog articles. Extension of VHS CI workflow (`d85e30d`). |
| **CLI aliases** (broadcast/listen/swarm) | `db4c315` | Convenience aliases for pub/sub and fleet commands. Test hardening in same commit. |
| **Cost tracker + Observability routes** *(COMMITTED 2026-04-05)* | `0169b17` | `lib/cost-tracker.ts` (319 lines), `routes/observability.ts` (162 lines), `tests/unit/cost-tracker.test.js` (165 lines). Per-spawn LLM cost recording, budget checks, fleet budget integration. 6 Fastify endpoints. CLAUDE.md, README, SKILL.md, API reference all updated. **First concrete Phase 2 infrastructure.** Was uncommitted for 5 days; finally landed. `lib/counters.ts` (ODS-style time-bucketed metrics) remains **untracked** — the last piece of the observability trifecta. |
| **Fleet Config UI** *(UNCOMMITTED)* | WIP on disk | `fleet-config-ui/` — React app with AgentCard, AgentConfigPanel, FlowGraph, YAMLEditor, SortiePanel, DMPanel, ChannelLog, ProjectPicker. Goes beyond 3D (dashboard panel) toward a standalone fleet management application. Not yet committed. |
| **Fleet config read/write + prompt + models endpoints** *(UNCOMMITTED)* | WIP on disk | `GET /fleet/config/:project`, `PUT /fleet/config/:project`, `GET /fleet/prompt`, `GET /fleet/models` added to `routes/fleet.ts` (72 new lines). Config read/write with topology validation and fleet reload. Prompt endpoint for shell integration. Models endpoint for backend catalog. All 4 routes registered in `routes/index.ts` and `features.manifest.json`. Backend for Fleet Config UI. Not yet committed. |
| **FleetBar Cost Dashboard** *(UNCOMMITTED)* | WIP on disk | `apps/FleetBar/FleetBar/CostDashboard.swift` + `CostStore.swift`. Native macOS cost visualization in FleetBar menu bar app. Consumes cost-tracker endpoints. Not yet committed. |
| **Spawner refactoring + global spawn ceiling** | `0df9155` | `lib/spawner.ts` — shared `runChild()` abstraction (eliminates 3x copy-paste across backends) + MAX_CONCURRENT_RUNNING = 20 hard ceiling prevents fork bombs. Root cause: fleet triggers on git commit spawned 5+ agents simultaneously. Was uncommitted for 5 days; landed 2026-04-05. |
| **Fleet limits in pd-fleet.yml** | `0df9155` | `max_concurrent_spawns: 2`, `max_spawns_per_hour: 10` added to the dogfood fleet config. Exercises the fleet limits feature (shipped in v3.8.2). Committed alongside spawn ceiling fix. |
| **Spider connection analyses** *(UNCOMMITTED)* | WIP on disk | 8 spider connection files from 2026-04-05 in `.spider/connections/`: connections, cost-era, deep-periphery, observability-era, periphery-era, seventh-sense, seventh-wave, sixth-sense. Fleet spider agent produced more output than prior runs. |
| **Recovery docs reorganization** | `bfe30e1` | `docs/recovery/` created as canonical hub: `README.md`, `UNIFIED-ROADMAP.md`, `IDEAS-TROVE.md`, `REPO-CLEANUP-AND-DISTRIBUTION.md`. Duplicate skill removed. Redirects added to `V4-UNIFIED-ROADMAP.md` and `V4-RECOVERY-MAP.md`. Establishes a "recovery and consolidation" track separate from the V4 feature roadmap. |
| **Budget param canonicalization + fleet budget gates** | `0169b17` | Fleet engine `budget_usd_per_day` enforcement at spawn time. Cost-tracker wired into fleet spawning decisions. Not just accounting — active budget gates that can stop spawns. Part of the cost-tracker commit but worth noting as its own capability. |
| **Fleet daemon integration — FleetBar launcher, UI prefs, setup CLI, fleet-ui serving** *(UNCOMMITTED)* | WIP on disk | `lib/fleetbar-launcher.ts` (launch FleetBar from daemon), `lib/ui-preferences.ts` (persist UI prefs), `cli/commands/setup.ts` (new setup command), `public/fleet-ui/` (fleet management UI served from daemon). Also: `tests/unit/spawner-commit-0df9155-bugs.test.js` (regression tests for spawn ceiling), `tests/unit/tunnel-lifecycle.test.js` (tunnel tests), `website-v2/src/data/tutorials.test.ts` (tutorial validation). Energy signal: fleet is evolving from "background agents" toward "first-class daemon subsystem with its own UI, launcher, and setup flow." |
| **Spider 2026-04-05 output** *(UNCOMMITTED)* | WIP on disk | 10 connection files in `.spider/connections/2026-04-05-*`: connections, cost-era, deep-periphery, eighth-wave, ninth-wave, observability-era, periphery-era, seventh-sense, seventh-wave, sixth-sense. Largest spider output batch to date. |
| **Recovery Track 1 closure — counters + observability trifecta** | `8744e14` | `lib/counters.ts` finally committed alongside cost-tracker and observability routes. Was "one commit away" for 3 cartographer runs. Also ships SortiePanel mission workspace slice and FleetBar native control-center window. Closes Recovery Track 1. Maps to Phase 2 infrastructure. |
| **Fleet runtime fallbacks + readiness checks** | `3b818d2` | Backend readiness/auth preflight for fleet agents. Ordered fallback backends/models with structured attempt data on failure. Maps to Recovery 3.8.3 criteria. Not in V4 roadmap phases. |
| **Agent autopilot + sortie planning** | `71fc446` | `pd agent autopilot` mode and sortie (one-off mission) planning. Fleet product work — not in any roadmap phase. |
| **Setup onboarding + help discoverability** | `0cc5e6` | `pd setup` improvements — help discoverability, onboarding flow polish. Maps to Recovery 3.8.3 onboarding criteria. |
| **FleetBar unified with fleet-config-ui** | `a41f18f` | FleetBar menu bar app now shells the real `/fleet-ui/` web surface via `FleetControlCenter` WebView. Eliminates the shadow native dashboard. Maps to Recovery Track 2. |
| **FleetBar control plane hardening** | `e82f096` | Hardens FleetBar control plane entrypoints — security/robustness for the unified WebView surface. Maps to Recovery Track 2. |
