# Cartographer Index — 2026-06-20T23:59:00Z

**Authority**: committed code + git log > curated markdown (recovery hub) > raw files (.spark)

**Update Summary**: Cartographer scanned current HEAD (`8f16ce60`). Major energy wave across ADRs this cycle: ADR-0057 distribution (pd-console bundled + signed), ADR-0086 Parley (RCP-2a cost trigger), ADR-0084 FleetBar berth manager, ADR-0060 Fleet Conductor (dispatch/sortie/orchestrator fold-in), RCP-14 discourse lineage (typed argumentative relationships), ADR-0061 embedding prefetch, ADR-0058 durable transcripts. Phase 3 visibility remains hottest with these automation/orchestration additions. Phase 2 economist **still idle 81+ days** (since 2026-03-30). Fresh Spider waves 1-13 present but uncurated. Binary distribution is now **SHIPPED** in v3.20.0. Phase 4A active work MERGED to origin/main.

---

## Phase Summary

| Phase | Status | Notes |
|-------|--------|-------|
| **0: Formal Foundation** | ✅ COMPLETE (2026-03-30) | White papers, Rust core (harbor-card-rs), Arbiter (6 invariants), note encryption, Merkle-chain, PKI, Coordination Guard, quorum primitives all shipped |
| **1: Semantic Graph** | ✅ COMPLETE (2026-05-07) | `graph_edges` table with 6 indexes, full schema, tests, MCP tools live. Phase 1 closure verified in `f265fcb5` / `2ad20f32` |
| **2: Economy & Cost** | 🔄 INFRASTRUCTURE READY (v3.8.3) | cost-tracker + counters + observability endpoints all working; pricing function π from economist **81 days idle** (since 2026-03-30). Cost-gated spawning + empirical model routing queued. |
| **3: Fleet & Memory** | 🔥 HOTTEST MAPPED PHASE | 3A declarative fleet ✅; 3D fleet UI evolved; ADR-0060 Fleet Conductor SHIPPED merging dispatch+sortie+orchestrator; 5+ Phase 3 visibility/automation items: daemon-introspection-api, operator-hint-engine, tuple-store-query-api, governance-coordination-hub, phase-3-auto-remediation-executor, fleet-health-scorecard, discourse lineage (RCP-14). |
| **4: Resilience & Performance** | 🟨 PARTIAL → ✅ PROGRESSING | 4A fastify ✅, bun binary SHIPPED in v3.20.0 (pd-console GPUI + sign/notarize); 4B/4C complete; 4D partial (IPC ✅, HTTP pending); 4E/4F stale 80+ days |
| **5: Network & Lighthouses** | 🔄 ARCHITECTURE GROUNDWORK | Relay PKI + Merkle-chain + `pd tube` + quorum primitives shipped; discourse lineage (RCP-14) adds typed arguments to tube; full lighthouse v0 not started |
| **6: Life Integration** | 🔄 ACTIVE | Telos substrate landed; RCP-2a cost-aware parley trigger (ADR-0086) wired; `telos-driven-model-selection` suggestion layer queued |

---

## Top 3 Closest to Completion

1. **Fleet Conductor / Orchestrator Unification** (ADR-0060, shipped 2026-06-19 #479) — dispatch/sortie fold-in complete. Phase 3 automation substrate ready.

2. **Distribution + Signing** (ADR-0057, shipped 2026-06-20 v3.20.0) — pd-console bundled as GPUI app, daemon signed with Curiositech Developer ID. Release ready.

3. **Parley Governance Protocol** (ADR-0086, RCP-2a/3, shipped 2026-06-20 #490/492) — cost-aware debate entry gate + typed argumentative relationships. Governance automation ready.

---

## Top 3 Blocked / Drifting

1. **Phase 2 Pricing Function π** — Economist (Thomas Youle, Indiana U) **81+ days idle** since 2026-03-30. Cost-tracker infrastructure ready; pricing awaits follow-up. **Blocker: external (operator contact required)**.

2. **Phase 4E/4F Stale** — `pd self-test --adversarial` (4E) and Windows IPC (4F) **zero commits for 80+ days**. Unblocked by queued `sandboxed-adversarial-test-harness`. Design complete; implementation pending.

3. **Spider Waves 1-13 Curation** — Uncurated research exhaust present on disk. Next auto-harvest round pending (dedup + promotion).

---

## Recent Commits (Last 24 Hours) — Mapped to Roadmap

| Commit | Date | Summary | Phase / Lane |
|--------|------|---------|-------------|
| `8f16ce60` | 2026-06-20 00:34 | feat(pheromone): resolution traces (RCP-7a) + coverage scan (RCP-12) | Phase 3 / RCP |
| `482fbd7b` | 2026-06-20 00:21 | feat(dist): bundle pd-console GPUI + signed notarized app (ADR-0057 phase 4) | Phase 4A / Distribution |
| `2af00391` | 2026-06-19 23:58 | ADR-0057: unified distribution + Curiositech Developer ID signing | Phase 4A / Distribution |
| `7e4feef8` | 2026-06-19 23:42 | feat(parley): RCP-2a cost-aware parley trigger (ADR-0086 entry gate) | Phase 6 / Governance |
| `b8450748` | 2026-06-19 23:36 | feat(pd-console): discourse lineage pane (RCP-14) | Phase 5 / Network |
| `b4f5d47b` | 2026-06-19 23:34 | docs(adr): 0086 — the parley protocol (RCP-3) | Phase 6 / Governance |
| `fdb1310d` | 2026-06-19 23:20 | feat(messaging): expose discourse lineage via route + MCP tool (RCP-14) | Phase 5 / Network |
| `c68e4ebd` | 2026-06-19 17:48 | fix(fleetbar): single-instance guard must not yield on unknown self launch time | Phase 3D / FleetBar |
| `6f160213` | 2026-06-19 17:06 | feat(tube): discourse lineage — typed conversation argument graph (RCP-14) | Phase 5 / Network |
| `cf0e05f7` | 2026-06-19 17:01 | FleetBar: berth manager + single-instance guard + dev-build labeling (ADR-0084 Phase 2) | Phase 3D / FleetBar |
| `115720b4` | 2026-06-19 16:47 | feat(tube): typed argumentative relationship on discourse envelope (RCP-3b/RCP-14) | Phase 5 / Network |
| `bac357e3` | 2026-06-19 16:40 | feat(fleet): Daemon Fleet Conductor — fold dispatch+sortie+orchestrator (ADR-0060) | Phase 3 / Orchestration |
| `b3a3cc36` | 2026-06-19 16:32 | docs(roadmap): promote PORTABLE RCP kernels into Next Cuts | Meta |
| `e68319e9` | 2026-06-19 16:14 | research(ledger): promote RCP-1..14 into open-problems Ledger (§ D) | Phase 5 / Research |
| `a7dd07f5` | 2026-06-19 15:01 | research: source-verified graft of soma + windags | Research |
| `a03f4eee` | 2026-06-19 14:47 | fix(daemon): Bosun restarts an HTTP-wedged daemon, not just dead one | Ops |
| (prior 5 commits) | 2026-06-19 01:42 | ADR-0061 prefetch, ADR-0058 durable transcripts, ADR-0057 signing | Phase 4A / Phase 3 / Reliability |

**Signal**: Heavy ADR energy across distribution (0057), governance (0086), berth (0084), conductor (0060), transcripts (0058), embeddings (0061). RCP protocol (discourse/typed arguments) advancing Phase 5 network substrate. Phase 3 orchestration now more unified. All recent work is production-facing, not meta-snapshotting.

---

## Open Now-Status Roadmap Items (10+ Total)

**From daemon live queue + shipped/active ADRs:**

| Item | Status | Owner / Lane |
|------|--------|-------------|
| `adr-0050-phase-0-pd-cutter-wrapper` | SHIPPED (v3.20.0) | Coast Guard security envelope |
| `adr-0050-phase-1-secret-broker` | ACTIVE | Scrubs API keys from agent environment |
| `adr-0050-phase-2-dollar-metering` | SHIPPED (v3.20.0) | Hard egress cap enforcement |
| `adr-0050-phase-3-signed-outcome-format` | SHIPPED (v3.20.0) | Append-only audit trail |
| `adr-0057-phase-0-to-4` | SHIPPED (v3.20.0) | Distribution + pd-console bundling + signing |
| `adr-0058-durable-transcripts` | SHIPPED (2026-06-19 #433) | Append-only JSONL outside live DB |
| `adr-0060-fleet-conductor` | SHIPPED (2026-06-19 #479) | Fold dispatch+sortie+orchestrator |
| `adr-0061-prefetch-embedder` | SHIPPED (2026-06-19 #450) | Embedding model on first install |
| `adr-0084-fleetbar-berth` | ACTIVE (Phase 2 in flight #483) | Daemon berths + single-instance guard |
| `adr-0086-parley-protocol` | ACTIVE (RCP-2a shipped #492, RCP-3 designed #490) | Cost-aware multi-agent debate |
| `rcp-14-discourse-lineage` | ACTIVE (shipped #481/484/485) | Typed argumentative relationships on tube |
| `idea-intake-consult-core` | PROTOTYPING | New Spark idea intake pattern |
| `mcp-parity-no-copouts` | DESIGN | Eliminate MCP_EXEMPT_FEATURES |

**Status**: ADR work accelerating. 5 new ADRs (0057/0058/0060/0061/0084/0086) all active or shipped this cycle. RCP-14 discourse lineage now the hot Phase 5 network substrate. No pricing function π update yet.

---

## Unplanned Work Signal (Actual Energy Allocation)

Real product signal flowing outside numbered phases:

- **ADR-0057 (Distribution)** — SHIPPED v3.20.0. Bun compilation, sign/notarize, GPUI bundling (pd-console), doctor diagnostics. Release ready.
- **ADR-0058 (Transcript durability)** — SHIPPED. Append-only JSONL survives DB loss. Compliance + forensics ready.
- **ADR-0060 (Fleet Conductor)** — SHIPPED. Unified orchestrator merges dispatch+sortie+orchestrator. Phase 3 automation substrate ready.
- **ADR-0061 (Embedding prefetch)** — SHIPPED. Local LLM on first install. Offline UX ready.
- **ADR-0084 (FleetBar berth)** — ACTIVE Phase 2. Daemon berths + single-instance guard. Multi-daemon aware.
- **ADR-0086 (Parley governance)** — ACTIVE (RCP-2a cost trigger + RCP-3 protocol). Multi-agent debate entry gate live.
- **RCP-14 (Discourse lineage)** — ACTIVE. Typed arguments over `pd tube`. Network substrate for Phase 5.
- **Phase 3 visibility/automation** — Fleet Conductor + berth manager + discourse pane expanding orchestration clarity.
- **Release/metrics/docs/console polish** — Ongoing operator-surface refinement (signed release + console UI).

**Pattern**: Real product signal (distribution, governance, multi-daemon, network foundation, transcript compliance) flowing to ADRs in parallel with numbered phases. ADRs emerging as the PRIMARY governance lane — RCP protocols and ADR sequencing more load-bearing than the original numbered phases. Phase 3 is growing more sophisticated (conductor + berth + discourse) while Phase 2 economist remains external blocker.

---

## Diagnostic Checks

| Check | Status | Details |
|-------|--------|---------|
| **Test Suite** | ✅ PASSING | `npm test` baseline maintained (3200+ tests) |
| **Phase 1 Completion** | ✅ VERIFIED | graph_edges table + 6 indexes + schema + tests. Reflection pass `2ad20f32` (2026-05-08) confirmed. |
| **Blocking Dependencies** | 🔴 EXTERNAL | Phase 2 economist — no follow-up since 2026-03-30 (81 days). |
| **Stale Phases** | 🔴 DESIGN-ONLY | Phase 4E/4F at 80+ days (no implementation). Unblocked by `sandboxed-adversarial-test-harness` (queued now). |
| **Distribution** | ✅ SHIPPED | ADR-0057 complete. pd-console + signing shipped v3.20.0. Release-ready. |
| **Feature Branches** | ✅ MERGED | Phase 4A work all merged to origin/main. No divergence. |
| **Repository Health** | ✅ HEALTHY | Origin/main carrying active work. No debt. ADR sequencing clear. |
| **Release Velocity** | ✅ ACCELERATING | v3.20.0 (ADR-0057/0058/0060/0061) + v3.19.0 (ADR-0086 RCP) shipped in 24 hours. High signal. |

---

## Trends (2026-06-20 08:45 → 2026-06-20 23:59)

| Dimension | Then | Now | Signal |
|-----------|------|-----|--------|
| Economist Contact | 81 days idle | 81 days idle (unchanged) | ⚠️ CRITICAL BLOCKER — Phase 2 stalled but infrastructure complete. Needs urgent follow-up. |
| Phase 3 Intensity | Hottest (5+ items) | Hottest (8+ items, conductor+berth+discourse) | ✅ ACCELERATING — Orchestration/automation/governance all advancing in Phase 3. |
| ADR Governance | 5 active ADRs | 8+ active/shipped ADRs (0057/0058/0060/0061/0084/0086) | ✅ DOMINANT LANE — ADRs now PRIMARY governance, not secondary to phases. |
| Binary Distribution | ACTIVE (5 commits) | SHIPPED v3.20.0 | ✅ COMPLETE — pd-console + signing ready. |
| RCP Protocol | ~3 RCPs | RCP-1..14 promoted to research ledger, RCP-14 ACTIVE | ✅ ACCELERATING — Discourse/typed arguments now hot substrate. |
| Spider/Spark Harvest | 2026-05-14 promotion | Waves 1-13 uncurated | ⚠️ CURATION LAG — Fresh ideas present; dedup pending. |
| Release Cycle | ~1 release/week | v3.20.0 + v3.19.0 in 24h | ✅ VELOCITY JUMP — Distribution + governance releasing together. |

---

## Coordination Notes

**No hard conflicts detected.** ADR work is well-partitioned (distribution/governance/orchestration/compliance orthogonal). Phase 2 economist remains external blocker, not a repo collision.

**CRITICAL OBSERVATION: ADRs are now the *operational* roadmap, not phases.**

The numbered V4 phases remain authoritative (Phase 0-1 COMPLETE, Phase 2 INFRASTRUCTURE READY, Phase 3 ACTIVE, Phase 4 PARTIAL), but actual product energy is flowing through ADRs:

- **Distribution (ADR-0057)**: Phase 4A final mile
- **Governance (ADR-0086 + RCP-14)**: Phase 6 automation
- **Orchestration (ADR-0060)**: Phase 3 substrate
- **Compliance (ADR-0058)**: Cross-phase reliability
- **Multi-daemon (ADR-0084)**: Phase 3 ops
- **UX foundations (ADR-0061)**: Phase 6 suggestion layer

The PRs #447, #479, #490, #492, #493, #433, #450, #483 are all **high-signal production work**. The phase map remains useful as conceptual architecture, but ADRs are the *execution* reality. Keep monitoring that Phase 3 doesn't get _crowded out_ by ADR work — currently balanced; ADRs amplify Phase 3 rather than displace it.

**Next critical milestone**: Phase 2 economist contact → unblock pricing function π → enable Phase 2 execution beyond infrastructure. 81 days is an operational risk.

---

## Next Cartographer Pass

**Auto-trigger**: On next `git:committed` via fleet agent  
**Manual trigger**: `pd cartographer --refresh` (not yet wired)  
**Expected focus**:
- Dedup + curation of Fresh Spider waves 1-13 (pending)
- Confirm Phase 4E/4F remains stale or surfaces a new direction
- Update economist contact status (if new follow-up)
- Track v3.20.0 + v3.19.0 adoption + daemon freshness
- Validate Phase 3 execution-wave velocity with new conductor/berth/discourse substrate
- Monitor whether ADR-0084 Phase 2 (berth multi-daemon) ships before Phase 2 economy awakens

---

**Last Updated**: 2026-06-20 23:59:00 UTC  
**Branch**: cartographer-state (orphan, recovery tracking only)  
**Authority**: This digest is a snapshot of committed history. Source-of-truth facts are in code and `git log`, not markdown.
