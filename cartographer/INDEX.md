# Cartographer Index — 2026-06-19T22:30:00Z

**Authority**: Committed code (origin/main: `a7dd07f5`) > git log > curated markdown (recovery hub) > raw files (.spider, .spark)

**Cartographer Snapshot**: Phase 0–1 complete, Phase 2 infrastructure ready (economist idle 81d), Phase 3 hottest (13+ curated execution items + 8 ADR-0050 security/accountability items), Phase 4 partial (4A off-main, 4D partial, 4E/4F stale 80d+), Phase 5 architecture, Phase 6 active (telos substrate shipped).

---

## Phase Summary

| Phase | Status | Notes |
|-------|--------|-------|
| **0: Formal Foundation** | ✅ Complete | White papers, Rust core, Arbiter, PKI, Coordination Guard, Merkle-chain, proofs all shipped |
| **1: Semantic Graph** | ✅ Complete | `graph_edges` table + 6 indexes verified 2026-05-07 (`f265fcb5`); Phase 1 provides conflict prediction and claim safety for all downstream lanes |
| **2: Economy & Cost** | 🔄 Infrastructure Ready | Cost-tracker + counters + observability endpoints live; pricing function π awaits economist (idle since 2026-03-30, 81 days) |
| **3A: Declarative Fleet** | ✅ Shipped | Fleet YAML + auto-respawn + pheromone system all live |
| **3B: Episodic Memory** | 🟨 Queued | Routes ready; CLI/UI surfaces not yet committed |
| **3C: Deep `pd scan`** | ⏸️ Blocked | Downstream of Phase 2 |
| **3D: Fleet Dashboard** | 🔄 Evolved | Standalone Fleet Live + FleetBar (native) + Fleet Config UI (uncommitted WIP) exceed original "panel" spec |
| **3 Visibility/Automation** | 🔥 HOTTEST | 13+ curated items + 8 ADR-0050 phases (Phase 0–3 active) in execution wave |
| **4A: Bun/Fastify** | 🟡 Active Off-Main | Fastify ✅; Bun binary / doctor / distribution work lives on `feat/binary-distribution-daemon-unblock` + `feat/doctor-binary-daemon-diagnostics` (5 commits, not yet on stable) |
| **4B: IPC** | ✅ Complete | Binary IPC + MessagePack + backpressure all shipped v3.8.2 |
| **4C: Radix Trie** | ✅ Complete | Semantic index + harbor bitmask filtering shipped v3.8.1 |
| **4D: Backpressure** | 🟨 Partial | IPC-level ✅; HTTP-level not started |
| **4E: `pd self-test --adversarial`** | 🔴 Stale | 80+ days; unblocked by `sandboxed-adversarial-test-harness` (2026-05-13 promotion, now in execution wave) |
| **4F: Windows IPC Hardening** | 🔴 Stale | 80+ days; design complete, zero commits |
| **5: Network & Lighthouses** | 🔄 Architecture | Relay PKI + Merkle-chain + `pd tube` + quorum primitives shipped; full lighthouse v0 not started |
| **6: Life Integration** | 🔄 Active | Telos substrate landed; explicit `telos-driven-model-selection` suggestion layer remains open |

---

## Top 3 Closest to Completion

1. **`incremental-symbol-index-refresh`** (Spark 2026-05-12) — ~150 LOC file-change watcher; keeps Phase 1 graph current as files change
2. **`symbol-graph-visualization`** (Spark 2026-05-12) — ~4 hours; force-directed graph view for Phase 1 conflict prediction
3. **`daemon-introspection-api`** (Spark 2026-05-09) — ~150 LOC `GET /daemon/introspect`; unlocks Crew Screen + Fleet Health Scorecard

---

## Top 3 Blocked / Drifting

1. **Phase 2 Economist** — 81 days idle since Thomas Youle contact (2026-03-30); pricing function π is the critical blocker; cost-tracker infrastructure is ready
2. **Phase 4A Binary Distribution** — Active off-main on feature branches (`feat/binary-distribution-daemon-unblock`, `feat/doctor-binary-daemon-diagnostics`); 5 commits carry Bun release, sign-and-notarize, and LaunchAgent doctor diagnostics; not yet merged to stable
3. **Phase 4E/4F Hardening** — 80+ days stale; design complete, zero commits; unblocked by `sandboxed-adversarial-test-harness` (now in execution wave)

---

## Recent Commits Unmapped to Roadmap (Last 7 Days)

All 30 recent commits are cartographer digests (status snapshots + index refreshes). No new V4 phase work landed on origin/main since 2026-06-15 (v3.19.0 Parley + v3.18.0 Coast Guard release prep).

**Release energy** (not V4 phases): v3.20.0 Coast Guard / v3.19.0 Parley shipped; FleetBar + metrics + docs polish on origin/main.

**Off-main activity**: Phase 4A binary / doctor / distribution work is active on feature branches (`6a8c8bb1`, `0d99bdfe`, `cd283478`, `72461802` from earlier passes).

---

## Open Dogfood Feedback & Roadmap Projections

**Daemon tuple feedback** (via `pd roadmap --feedback-status open --json`):
- Live queue: 0 open entries after 11 harvested items
- Curated dogfood pair (status=`now`): `claim-preserving-git-safety`, `fleet-launchability-and-cadence`

**Daemon-projected now-status roadmap items** (8 discovered via daemon + ADR-0050 security suite activation):
1. `idea-intake-consult-core` — Spark intake routing
2. `swarm-coordination-parley` — v3.19.0 shipped; next: bounded-debate UI surfaces
3. `mcp-parity-no-copouts` — Convert remaining CLI-only surfaces to first-class MCP tools
4. `adr-0050-phase-0-pd-cutter-wrapper` — Coast Guard wrapper; Phase 0 active in v3.18.0+
5. `adr-0050-phase-1-secret-broker` — Scrub API keys from agent environment; active in v3.18.0+
6. `adr-0050-phase-2-dollar-metering` — Hard egress cap on provider spend; active in v3.18.0+
7. `adr-0050-phase-3-signed-outcome-format` — Typed receipt + publisher sequence; Phase 3 active in v3.18.0+

**Trove-backed execution wave** (34 curated items in `docs/recovery/UNIFIED-ROADMAP.md`, not including Phase 3D uncommitted work or Phase 4A feature-branch work):
- High-priority nearest (1–5): `incremental-symbol-index-refresh`, `symbol-graph-visualization`, `daemon-introspection-api`, `operator-hint-engine`, `ideas-trove-queryable-surface`
- Phase 3 visibility cluster (13+ items): daemon-introspection-api, crew-screen-roles-not-pids, fleet-health-scorecard, coordination-ticker-as-high-signal-feed, fleet-run-journal, daemon-fleet-auto-recovery, tuple-store-query-api, governance-coordination-hub, phase-3-auto-remediation-executor, operator-manual-fleet-dispatch, episodic-memory-query-surfaces, orchestrator-decision-attribution, symbol-staleness-merge-safety (extension)

---

## Active Off-Main Work (Not Yet on Stable)

| Branch | Work | Commits | Status |
|--------|------|---------|--------|
| `feat/binary-distribution-daemon-unblock` | Bun binary release + sign-and-notarize | 5 (2026-04-01 to 2026-05-14) | Active; not yet promoted to stable |
| `feat/doctor-binary-daemon-diagnostics` | LaunchAgent plist detection + resource diagnostics | (same) | Active; not yet promoted to stable |

---

## Fresh Spark / Spider Research (Uncurated)

**Spider waves** (13 connection files from 2026-06-19):
- `.spider/connections/2026-06-19-connections*.md` (waves 1–13 + base)
- Patterns identified in fresh pass: (to be analyzed during next harvest)

**Spark harvest status**:
- Last curated promotion: 2026-05-16 (`orchestrator-decision-attribution`)
- Raw 2026-06-19 pass likely present but requires dedupe pass before entry into execution wave
- `.spark/ideas/` directory present; `.spark/feedback/` tree not present in this checkout

---

## Health Signals

| Signal | Status | Notes |
|--------|--------|-------|
| Test suite | ✅ Passing | `npm test` all green |
| 7-day velocity | 🟨 Low | 30 commits = all cartographer digests (status snapshots); zero V4 phase commits since 2026-06-15 |
| Phase 1 completion | ✅ Verified | Graph edges + 6 indexes + tests + MCP; verified 2026-05-07 |
| Phase 2 blocking dependency | 🔴 Open | Economist follow-up (81 days idle) |
| Phase 3 heat | 🔥 Hottest | 13+ curated items + 8 ADR-0050 items in execution wave; active dogfood signal |
| Phase 4A binary work | 🟡 Active | Off-main on feature branches; distribution unblocked once merged and tested |
| Coordination Guard | ✅ Enforce mode | Live in stable; extended enforcement (SessionStart/PreToolUse) queued |
| Release energy | 📢 High | v3.18.0 Coast Guard (ADR-0050 security suite) + v3.19.0 Parley (bounded-debate framework) + v3.20.0 bumped; product surface polish ongoing |

---

## What Happened This Session

1. **Cartographer digests remain frequent** (30 commits in last 7 days = status snapshots). This signals the operator is monitoring the map actively but not dispatching new V4 work.
2. **v3.18.0 Coast Guard landed** — ADR-0050 security/accountability suite (4 phases) is now active. This is unplanned work that escaped the V4 numbered phases.
3. **v3.19.0 Parley landed** — Bounded multi-agent debate framework. Also unplanned-phase work.
4. **Fresh Spider research** (13 connection waves from 2026-06-19) is present but uncurated. Requires next harvest pass.
5. **Phase 4A binary work** remains active off-main; no promotion to stable yet.
6. **Economist remains idle** (81 days). Cost-tracker infrastructure is ready to receive pricing function π.
7. **Dogfood pair unchanged**: `claim-preserving-git-safety` and `fleet-launchability-and-cadence` remain the curated now-status dogfood items.

---

## Next Cartographer Actions

1. **Dedupe + harvest** 2026-06-19 Spider waves into connection patterns or ideas surface
2. **Monitor** Phase 4A feature branches for readiness to promote to stable
3. **Flag** Phase 2 economist dependency (81 days) for explicit operator decision: wait, hire, or pivot to alternative pricing model
4. **Reflect** on whether v3.18.0 Coast Guard + v3.19.0 Parley should formally enter the V4 roadmap as Phase 3A1 / Phase 3A2 work (they represent real product energy outside the numbered phases)

---

**HEAD (cartographer-state)**: 405d3d4b | **HEAD (origin/main)**: a7dd07f5 | Divergence: 1491 commits ahead on main, 18 commits on cartographer-state branch not in main
