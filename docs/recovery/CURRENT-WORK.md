# Current Recovery Work

Last updated: 2026-05-22 UTC (Cartographer plan-backlog ingestion follow-up to PR #166 — gap-fill pass over 4 long-form `docs/plans/` files: TUBE-as-coordination-substrate roadmap, phone-integration master plan, anchor protocol workstream backlog, worktree-swarms. New section "Plan-backlog ingestion 2026-05-22" enumerates ~60 still-open deliverables not covered by PR #166's hanging-chad sweep, organized into 4 clusters: TUBE (3 blockers + Phase 0 + Phases 1-8), PHONE (Tracks B3/C/D/E + PKI v1/v2), ANCHOR (AP-001..AP-022 in clusters A-F), WORKTREE-SWARMS (worktree-harbor binding, metadata decay daemon, swarm dashboard). PR #166 itself captured 24 hanging chads from the 2026-05-21 session under "Session backlog 2026-05-21": brew 3.15.0 bump, GitHub App receiver + registration, server.ts transcripts wiring, CLI-tube session/continue, FCC Backend Swift port, FleetBar build, Anchor paper Bonded upgrade, v2.6 dialogue-synthesis tex edits, Federated Harbor paper, TLA cherry-pick, Apalache CI cache, Wave C archive/SDK push/needs-review, worktree pruning, pre-push hook + destructive-log CLI under `pd guard`, `pd nightshift` removal, `merge_policy: auto` (blocked on harbormaster), dashboard panel-backend cleanup, MCP `pd backend` registration, `pd whois` (PR #122), and `pd attention` adoption. Prior 2026-05-16 19:10 UTC pass: harvest/promotion — fresh 2026-05-16 Spark ideas curated; `orchestrator-decision-attribution` promoted to execution wave (#34); `symbol-staleness-merge-safety` marked EXTENDS: operator-hint-engine. Snapshot remains: `graph-based-merge-conflict-predictor`, `ambient-anomaly-signaling`, `symbol-graph-visualization`, `incremental-symbol-index-refresh`, `operator-hint-engine`, `symbol-claim-isolation-validator`, `orchestrator-plugin-lifecycle`, `daemon-fleet-auto-recovery`, `graph-integrity-auditor`, `agent-skills-quality-gates`, `cost-forecast-alert`, and `ipc-queue-saturation-promotion` in curated execution wave; 2026-05-13 extended promotion: `cost-gated-spawning`, `empirical-model-efficiency-routing`, `operator-decision-journal`, `sandboxed-adversarial-test-harness`; 2026-05-14 promotion: `tuple-store-query-api`, `governance-coordination-hub`, `phase-3-auto-remediation-executor`, `cost-aware-model-training-loop`, `unified-spawn-risk-synthesis`, plus `episodic-memory-query-surfaces` as Phase 3B memory cut and `operator-manual-fleet-dispatch` as Phase 3 dispatch workbench; 2026-05-10 Phase 4 resilience: `salvage-root-cause-classifier`; raw 2026-05-10 Spider exhaust (S41/S42/S43) still uncurated; fresh 2026-05-16 Spark/Spider exhaust mostly processed (orchestrator-decision-attribution curated, symbol-staleness marked extension); origin/main: 35 non-shared commits on release-prep / metrics / docs-polish; Phase 4A binary/doctor on feature branches, not promoted; prior: continuation `d017bc28`, verification `f0398b9a`, extended promotion `bbbd19be`, mapping `4e2a9f01`)
Owner: Cartographer maintenance pass + curated dogfood queue (2 now-status items: `claim-preserving-git-safety`, `fleet-launchability-and-cadence`); live tuple-backed feedback projection is empty (`open: 0`, `harvested: 11`); direct `pd feedback list --status open --json` still hits `EPERM` on `~/.port-daddy/daemon.sock`; there is no `.spark/feedback/` tree
Authority: git log (1.3/day, 9 commits trailing 7d) > committed code > V4-UNIFIED-ROADMAP.md

This is the active execution ledger. If a task is in flight, it belongs here before it belongs in chat.

## Cartographer Snapshot (2026-05-16 Mapping Pass)

- **Current phase**: Phase 3 visibility / operational automation is the hottest mapped phase (`daemon-introspection-api`, `crew-screen-roles-not-pids`, `fleet-health-scorecard`, `coordination-ticker-as-high-signal-feed`, `fleet-run-journal`, `daemon-fleet-auto-recovery`, `operator-hint-engine`, `tuple-store-query-api`, `governance-coordination-hub`, `phase-3-auto-remediation-executor`). Phase 1 COMPLETE is still verified 2026-05-07 via `f265fcb5` and `2ad20f32`; the Phase 1-adjacent `ideas-trove-queryable-surface`, `orchestrator-plugin-lifecycle`, `incremental-symbol-index-refresh`, `symbol-graph-visualization`, and `symbol-claim-isolation-validator` support slices keep the semantic-graph/tooling lane active. Phase 2 cost optimization gained `cost-aware-model-training-loop`, and Phase 4B preflight hardening gained `unified-spawn-risk-synthesis`; `skill-degradation-contagion-early-warning` stays backlog under the Phase 3 governance lane. The 2026-05-14 `tuple-driven-fleet` routing cut adds a lower-priority Phase 3 dispatch lane beneath that visibility cluster, and `operator-manual-fleet-dispatch` adds the proactive workbench for routing pending tuples before the lane auto-routes; `episodic-memory-query-surfaces` keeps the Phase 3B Fleet & Memory lane from staying dormant. Phase 5 ARCHITECTURE and Phase 6 ACTIVE remain open; Phase 4A is active on feature branches but not yet promoted to origin/main or stable, while 4E/4F remain STALE (46 days, no commits). Fresh 2026-05-16 raw Spark/Spider exhaust is present but still uncurated, so it does not move the phase ranking this pass. The 2026-05-13 Spark promotion adds the latest five curated candidates to the phase map, and the 2026-05-13 extended Spark promotion adds `cost-gated-spawning`, `empirical-model-efficiency-routing`, `operator-decision-journal`, and `sandboxed-adversarial-test-harness`, so the queue shape changed again even though the phase ranking did not.
- **Velocity**: 9 commits in last 7 days = **1.3/day** (still post-May-1 heavy, but lower than the earlier 107-commit window). May 1–2 burst: 7 fleet-model/telos commits + 15+ docs content pages + cost-tracker work.
- **Unplanned work** (signal of where energy actually goes): Cartographer verification / status reconciliation (`f4624ebd`, `05e94639`, `3b9d17ce`, `e6bd1b88`, `670ab97b`, `f0398b9a`, `857f225c`, `d017bc28`, `bbbd19be`, `4e2a9f01`); May 1 fleet-model / telos hardening (`ffe098fe` through `2fc96f8b`); docs content fill (15+ new leaf pages in `/docs/concepts`, `/docs/best-practices`); relay/harbor mesh ADR (`60f72edd`, `48b6c54c`); whitepaper rewrite v2.5 (`e5226d1a`, `f9a422f5`, `637cecce`) plus the proof/conformance tranche (`18198c46`, `36af999b`, `d4484135`, `e973bbd2`, `8ea60834`, `27dce34f`, `b4a0fe50`); Phase 1 completion (`f265fcb5`, `2ad20f32`); 2026-05-11 Spark promotion (`5ee873cd`) that added `graph-based-merge-conflict-predictor` and `ambient-anomaly-signaling` to the curated wave; 2026-05-13 extended Spark promotion (`bbbd19be`) that added `cost-gated-spawning`, `empirical-model-efficiency-routing`, `operator-decision-journal`, and `sandboxed-adversarial-test-harness` to the curated wave.
- **Closest to completion** (33 execution-ready items; top 3 are the most immediate slices):
  1. `incremental-symbol-index-refresh` (Spark, 2026-05-12) — ~150 LOC incremental file-write watcher; keeps graph conflict prediction current as files change
  2. `symbol-graph-visualization` (Spark, 2026-05-12) — ~4 hours visual Phase 1 graph explorer; makes graph_edges visible instead of query-only
  3. `daemon-introspection-api` (Spark, 2026-05-09) — ~150 LOC unified `GET /daemon/introspect` endpoint; enables crew-screen-roles-not-pids and fleet-health-scorecard
  4. `operator-hint-engine` (Spark, 2026-05-11) — ~160 LOC decision layer; turns daemon anomalies into suggested next actions
  5. `ideas-trove-queryable-surface` (Spark, 2026-05-09) — ~180 LOC `pd ideas` CLI + HTTP API; enables Spark/Spider deduplication enforcement
  6. `orchestrator-plugin-lifecycle` (Spark, 2026-05-12) — Phase 1.5 user-extensibility wire; hot-load custom orchestrators without forking the daemon
  7. `daemon-fleet-auto-recovery` (Spark, 2026-05-13) — Phase 3 automation cut; persistent roles come back after daemon restart
  8. `graph-integrity-auditor` (Spark, 2026-05-13) — Phase 1 health cut; daily audit keeps graph quality trustworthy
  9. `agent-skills-quality-gates` (Spark, 2026-05-13) — Phase 2.5 bridge; validates skill trust before spawn confidence is trusted
  10. `cost-forecast-alert` (Spark, 2026-05-13) — Phase 2 forward-visibility cut; projects spend before budget surprises
  11. `ipc-queue-saturation-promotion` (Spark, 2026-05-13) — Phase 4B backpressure cut; saturation-aware spawn gating
  12. `cost-gated-spawning` (Spark, 2026-05-13) — Phase 2 spawn-time budget gate; enforces role budgets before runs start
  13. `empirical-model-efficiency-routing` (Spark, 2026-05-13) — Phase 2 efficiency routing; chooses the cheapest successful model from history
  14. `operator-decision-journal` (Spark, 2026-05-13) — Phase 2/3 governance trail; records approvals, overrides, and pauses
  15. `sandboxed-adversarial-test-harness` (Spark, 2026-05-13) — Phase 4E/4F isolated chaos harness; runs hardening tests off the live daemon
  16. `tuple-store-query-api` (trove, 2026-05-14) — Phase 3 queue-depth substrate for fleet-health-scorecard; exposes tuple backlog truth without raw tuple spill
  17. `governance-coordination-hub` (trove, 2026-05-14) — Phase 3 governance rollup; unifies dispute, liquidation, and skills-vote signals into one view
  18. `phase-3-auto-remediation-executor` (trove, 2026-05-14) — Phase 3 operational automation; executes operator-approved remediations after visibility and hints
  19. `cost-aware-model-training-loop` (trove, 2026-05-14) — Phase 2 cost feedback loop; teaches routing from operator overrides and budget breaches
  20. `unified-spawn-risk-synthesis` (trove, 2026-05-14) — Phase 4B preflight synthesis; combines cost, skill, dependency, harbor, and learning risk before spawn
  21. `claim-preserving-git-safety` (dogfood)
  22. `fleet-launchability-and-cadence` (dogfood)
  23. `coordination-guard-extended-enforcement` (trove)
  24. `crew-screen-roles-not-pids` (trove)
  25. `fleet-health-scorecard` (trove)
  26. `coordination-ticker-as-high-signal-feed` (trove)
  27. `quorum-driven-dynamic-launch` (trove; Phase 1 shipped in `cea02e1`, Phase 2 auto-spawn remains)
  28. `ipc-disconnect-instant-salvage` (trove)
  29. `telos-driven-model-selection` (trove)
  30. `graph-based-merge-conflict-predictor` (Spark, 2026-05-11) — Phase 4 merge-risk predictor on Phase 1 graph edges
  31. `ambient-anomaly-signaling` (Spark, 2026-05-11) — Phase 2 self-healing feed from daemon introspection and coordination-judge
  32. `symbol-claim-isolation-validator` (IDEAS-TROVE, 2026-05-12) — Phase 1/4 claim-safety validator; catches symbol ownership conflicts before a new lock or merge attempt
  33. `episodic-memory-query-surfaces` (trove, 2026-05-14) — Phase 3B memory surface; exposes cross-session recall/search across the already-shipped fleet/memory substrate
  34. `operator-manual-fleet-dispatch` (trove, 2026-05-14) — Phase 3 dispatch workbench; lets operators route pending tuples to a target agent or role before tuple-driven-fleet auto-routing takes over
- **Blocked or drifting**:
  - Phase 2 economy: economist (Thomas Youle) — no follow-up since 2026-03-30 (47 days idle)
  - Phase 4A binary / doctor slice: active on feature branches, not yet promoted to origin/main or stable
  - Phase 4E/4F `pd self-test --adversarial` + Windows IPC hardening: design complete, zero commits (2026-03-31 → 2026-05-16, 46 days)
- **Feedback harvest status**: 2026-05-14 Spark promotion complete — promoted 2 new Spark ideas from `.spark/ideas/` to execution wave on 2026-05-09 (`daemon-introspection-api`, `ideas-trove-queryable-surface`), 2 more on 2026-05-11 (`graph-based-merge-conflict-predictor`, `ambient-anomaly-signaling`), 5 on 2026-05-12 (`symbol-graph-visualization`, `incremental-symbol-index-refresh`, `operator-hint-engine`, `symbol-claim-isolation-validator`, `orchestrator-plugin-lifecycle`), 5 on 2026-05-13 (`daemon-fleet-auto-recovery`, `graph-integrity-auditor`, `agent-skills-quality-gates`, `cost-forecast-alert`, `ipc-queue-saturation-promotion`), 4 on 2026-05-13 extended promotion (`cost-gated-spawning`, `empirical-model-efficiency-routing`, `operator-decision-journal`, `sandboxed-adversarial-test-harness`), and 5 on 2026-05-14 (`tuple-store-query-api`, `governance-coordination-hub`, `phase-3-auto-remediation-executor`, `cost-aware-model-training-loop`, `unified-spawn-risk-synthesis`) plus `episodic-memory-query-surfaces` as the Phase 3B memory cut and `operator-manual-fleet-dispatch` as the Phase 3 dispatch workbench; 2 dogfood now-items already curated (`claim-preserving-git-safety`, `fleet-launchability-and-cadence`); live tuple-backed feedback projection is empty (`open: 0`, `harvested: 11`), while direct `pd feedback list --status open --json` still hits `EPERM` on `~/.port-daddy/daemon.sock`; raw `.spark/feedback/` tree not present. `skill-degradation-contagion-early-warning` is still backlog, the 2026-05-10 raw Spider exhaust remains present on disk, and the five lower-priority now-status trove entries still queued below the execution wave are `fleet-run-journal`, `salvage-root-cause-classifier`, `forensic-context-windows`, `tuple-driven-fleet`, and `capability-discovery-dns-harbor`.

## Active Thread — Accounts Arc (Operator-Direct, 2026-05-23)

Per ROADMAP.md § Operator-Direct: Accounts Arc. Cartographer should preserve this entry verbatim.

**Currently in flight:** Phase A0 — `pd account create`. ~150 LOC, local-only Ed25519 keypair generation written to `~/.port-daddy/account.json`. Branch: `feat/account-create-and-roadmap`. ADR-0029 v0 step 1.

**Next after A0 lands:** A1 (`pd account pair` + daemon-side pairing receipts), then W0 (portdaddy.dev OIDC sign-in + account page).

## Active Side Thread

Public-site direction is now a hybrid preservation pass, not an `agentsd.ai` replacement:

- do not erase the current broad `website-v2` route surface
- keep the existing home page and current top-level pages reachable
- treat the newer docs-family shell, structured docs content, and shared site primitives as additive improvements
- strip active `agentsd` branding from the live website shell
- keep the `docs/AGENTSD_*` documents as quarantined research, not as implementation authority for the active site

## Quarantined Reset Research

New public-site reset work for `agentsd.ai` is now captured on disk:

- `docs/AGENTSD_AI_SITE_CONTRACT.md`
- `docs/AGENTSD_BRAND_IDENTITY.md`
- `docs/AGENTSD_DEVELOPER_DOCS_SYSTEM_PLAN.md`

This research thread remains on disk, but it is not the current implementation direction. The user explicitly rejected using it to replace the active site.

Key constraints now captured there:

- `agentsd.ai` gets a tiny public route surface (`/` and `/docs/**`)
- no migration of the old `portdaddy.dev` page tree
- no hand-wired route jungle like the current `website-v2/src/main.tsx`
- no ad hoc page markup outside the React component library
- Storybook, semantic tokens, Radix primitives, dark mode, and accessibility are ship gates
- public `agentsd` brand is distinct from internal `Port Daddy` lineage
- maritime language survives in-product, not as the homepage identity

Implementation truth now also exists in the working tree:

- `website-v2/src/main.tsx` is cut down to `/` plus `/docs/**` with fallback redirects
- new public shell components live under `website-v2/src/components/site/`
- `website-v2/src/data/publicSite.ts` is the generated docs/landing content registry for the new shell
- `website-v2/src/styles/tokens.css` now carries the new paper/ink/blue/lime public token system instead of the old harbor-heritage palette
- the landing page is now rebuilt against the `v0-agentsd-main` composition language: hard color blocking, proof terminals, architecture diagram, open-core pricing grid, and docs mosaic
- homepage copy is now product-facing instead of repo-facing: no `portdaddy.dev` references, no self-referential "public shell" language, and no cleanup-ticket tone on the public surface
- public docs are reduced to the approved section set via `DocsOverview` + `DocsSectionPage` instead of the previous route forest
- the next docs-system phase is now explicitly planned around a Cloudflare-style developer-docs IA: overview, get started, concepts, best practices, examples, tutorials, reference architectures, reference, and LLM exports
- docs discovery is now complete enough to move from analysis into execution:
  - `docs/AGENTSD_DEVELOPER_DOCS_SYSTEM_PLAN.md` now carries a salvage-now / salvage-later / quarantine map
  - the same plan now carries a concrete backlog `D1` through `D7` for registry, overview, get started, concepts, examples, tutorials/architectures, and LLM/reference exports
  - the plan also now force-ranks publication order: `Get Started`, `Whitepaper`, `Examples`, `Best Practices`, `Concepts`, `Reference`, `Reference Architectures`, then `Tutorials`
  - implementation ownership is intentionally split across disjoint write scopes instead of another monolithic docs rewrite
- current docs-system worker assignments:
  - `Carver`: docs registry and `/docs/**` route model
  - `Singer`: get-started and best-practices outline, source-truthed against code
  - `Tesla`: examples/tutorials/reference-architectures curation matrix with promote/rewrite/archive/delete classification
- integrated worker outputs now present in-tree:
  - `website-v2/src/docs-content/` contains structured source-backed `Get Started` and `Best Practices` section content
  - `docs/reports/D5-D6-PROMOTION-MATRIX.md` classifies examples/tutorials/reference-architectures into promote/rewrite/archive/delete
  - the active docs shell now uses the canonical docs-family model instead of rendering legacy section aliases like `guides` and `operations` as if they were canonical public sections
  - `/docs/get-started/*` and `/docs/best-practices/*` now have real leaf-page rendering driven by `website-v2/src/docs-content/` instead of static family-only placeholders
  - the docs rail and family landing pages now expose clickable subpage navigation for those two families
  - the `website-v2` shell contract test now enforces the leaf-content integration, and `website-v2` currently builds cleanly after the route/data rewrite
- Storybook coverage now exists for the new public shell primitives/header
- dark-mode bright-surface contrast failures have been corrected in the active shell by adding explicit blue/lime foreground tokens and moving terminal-style panels onto stable code-surface tokens
- routed docs status language is now `Live` / `Compatibility` / `Roadmap` with an in-page legend so module-state chips read as runtime truth, not fake links
- persona + appeal audit for the routed shell now lives at `docs/reports/AGENTSD_PUBLIC_SHELL_AUDIT_2026-04-11.md`

## Public Site Reset (2026-04-11, Quarantined)

The `agentsd.ai` public-site reset is now explicit repo work, not chat residue.

- New authority docs:
  - `docs/AGENTSD_AI_SITE_CONTRACT.md`
  - `docs/AGENTSD_BRAND_IDENTITY.md`
- These documents exist to prevent `portdaddy.dev`-style page sprawl, layout drift, mascot bleed-through, and public runtime overclaims from reappearing under the `agentsd` brand.
- Do not treat the old public site as a failure case or migration anti-target for active implementation.
- Future public-site work should preserve the current public surface unless a deliberate migration plan is approved and implemented.

## Current Thread

- 2026-05-19 three-tier memory vocabulary (Core/Recall/Archival):
  - ADR-0035 (`docs/adr/0035-three-tier-memory-vocabulary.md`) maps every
    PD construct (active sessions, file claims, notes, blobs, skill index,
    salvageable sessions) to a tier with eviction + access semantics.
  - `pd memory tiers` / `tier <construct>` / `summary` introspect the
    mapping with live counts against existing read-only endpoints. No
    schema, no substrate touch — vocabulary overlay only.
  - The briefing assembler is the next consumer; ADR-0035 lays out the
    "Core fully included, Recall TTL-ordered, Archival by pointer" rule.

- 2026-05-08 fleet-health-scorecard:
  - raw Spark idea promoted into `IDEAS-TROVE.md` and `docs/ROADMAP.md`
  - new Phase 3 dashboard follow-on for role health, cost burn, queue depth,
    and recent violations
  - `tuple-namespace-hierarchies` extends `tuple-driven-fleet` instead of
    minting a duplicate family

- 2026-05-19 substrate activation track opened:
  - Comprehensive audit of the production substrate against
    `~/port-daddy-stable/port-registry.db` (720MB, 44 tables). Findings doc at
    `.scratch/note-abstraction-audit.md`. Headline: PD has been quietly more
    complete than its surface suggests — pheromone module, semantic resolver
    (`Xenova/all-MiniLM-L6-v2`, 8k events/wk), Tube performatives, bond /
    budget, human-source feedback pipeline, harbor capability registry, Linda
    tuple space all exist in `lib/`. The verbs and surfaces are missing.
  - Three parallel research docs anchor the next sequencing
    (`.scratch/pheromone-visualization-research.md`,
    `.scratch/multiplayer-input-research.md`,
    `.scratch/agent-coordination-research.md`). Two transcript-ingestion docs
    (`transcript-recon.md`, `transcript-ingestion-design.md`) anchor the
    chat-capture work.
  - New ROADMAP.md § 8 "Substrate Activation — The Ambient Context Broker"
    captures the unifying architectural picture, the three typing rules
    (pheromones-for-graded-attention-never-facts; durable-edges-vs-ephemeral-
    presence; color-one-dim-glyphs-for-kinds), the economic-honesty rule for
    conscription, the "ride the busy rail" principle, and 11 cross-cutting
    design decisions with leans.
  - Phase 1 (~1 week, mostly mechanical) is the immediate next-step pile:
    - `coordination-counter-coverage` — ~13 metric_counters keys for dark
      coordination surfaces (tuples writes, messages, notes, claims, inbox,
      locks, resurrection)
    - `pd-whois-phonebook-surface` — surface the existing semantic resolver
      as the expertise phonebook; `pd whois <query>` returns ranked actors
    - `transcript-events-wiring` — wire the orphan `transcript_events` table
      + daemon-side tailer for Claude / Codex JSONL transcripts; cost-ledger
      already SELECTs from it
    - `pheromone-vocabulary-v1` — lock the ~15-20 kind catalog with per-kind
      half-life, decay-during-idle, and clear-events
    - `pd-roadmap-pop-production-trigger` — `roadmap_claims` is self-init in
      code but doesn't exist in production stable DB; ADR-0033 declares
      SHIPPED but no production invocations
    - `heartbeat-tmp-cleanup` — stale `.heartbeat.<pid>.tmp` zombies in
      `~/.port-daddy/` from older liveness mechanism
  - Resolved during audit: `roadmap_items` is acknowledged-new (per
    operator: "calm your tits, it does need a migration tho"); `pheromones`
    is module-real but table-less (storage = `metadata.pheromones` JSON on
    services/projects/sessions rows); 6 other doctrine ghosts identified
    (`signals`, `coordination_inconsistencies`, `briefing` table-less,
    `dns_records` zero-row).
- 2026-04-29 app-native development cockpit sketch:
  - New product sketch at `docs/shipwright/APP-NATIVE-DEVELOPMENT-COCKPIT.md`.
  - It ties roadmap intake, Idea Lab/Trove curation, Windags skill-grafted planning, Coordination Guard, multi-backend launches, worktree collapse, editor claim overlays, HITL decisions, Tube, and day-over-day progress logs into one Fleet Control Center cockpit.
  - The Idea Lab lane makes `IDEAS-TROVE.md` visible as the promotion surface for Spark/Spider output instead of treating raw `.spark/ideas/` or `.spider/connections/` files as backlog truth.
- 2026-04-29 stash/worktree harvest:
  - New stash recovery branches `codex/stash-exact-20260429-19-*` and
    `codex/stash-exact-20260429-20-*` are pushed.
  - Dirty worktree snapshots are pushed for root recordings, FCC, PR5
    Tube/PKI UI docs, OG branded social cards, and salvage-autostash
    screenshot proofs.
  - Reachability sweep preserved eight local-only branch tips under
    `codex/worktree-preserve-20260429-*`.
  - Recovery ledger: `docs/recovery/STASH-WORKTREE-HARVEST-2026-04-29.md`.
- 2026-04-29 cartographer map refresh:
  - `cartographer-roadmap-progress-screen` is now shipped via `7ba8d84`, `8fcf93e`, `4807cb5`, and `bd4fc6f`.
  - Closeout commits now pushed on `codex/agents-flow-guard-readable-ids`: `5f01294` (Agents pages + readable IDs), `eac3fc3` (live roadmap feedback), `4dba2a3` (Port Daddy agent skill bundle), and `629de64` (website content/proof media + FleetBar preview package metadata).
- 2026-05-07 follow-up:
  - `pd feedback list --status open --json` is unavailable here because `pd roadmap --feedback-status open --json` and `pd feedback list --status open --json` both hit `EPERM` on `~/.port-daddy/daemon.sock`, and this checkout does not contain a `.spark/feedback/` tree, so there were no markdown drops to mint or dedupe.
  - No new dogfood slugs were minted; there was no `.spark/feedback/` tree to curate on this checkout.
  - `f265fcb5` landed the `graph_edges` migration/schema slice and `2ad20f32` reflected it in the roadmaps, so `graph_edges migration` moved out of the close queue.
  - `50fe92ff` shipped the slot-scoped session-context hardening; `session-context-cwd-reset` was demoted out of the `now` bucket and the remaining follow-up is docs/help alignment.
  - `9e7d458` remains in the earlier maritime-layer unplanned bucket below; the newest burst is the salvage / release-surface / whitepaper / docs cleanup cluster above, so those commits are recorded as unplanned work below.
  - `pd roadmap --feedback-status open --json` and `pd feedback list --status open --json` both hit `EPERM` on `~/.port-daddy/daemon.sock`, so tuple-backed feedback projection was unavailable; there were no raw markdown drops to inspect because the checkout lacks `.spark/feedback/`.
  - The 2026-05-07 Spider extension pass (S17-S29, plus `remaining-spaces`) extends existing quorum / pheromone / graph / budget / incident families rather than minting a new backlog slug.

## Historical Recovery Radar (2026-04-28)

- Current phase: Recovery Track dominates; among V4 lanes, Phase 3 is the hottest mapped phase, Phase 2 is the closest to closure, and Phase 1 remains in-tree but not fully promoted. The freshest commit burst is still mostly outside V4, centered on salvage/recovery triage, website / release-surface / phone-integration work, and maritime actor / launchability hardening.
- Velocity: 132 commits in the last 7 days = 18.9/day.
- Closest to completion:
  - `claim-preserving-git-safety`
  - `fleet-launchability-and-cadence`
  - `session-context-cwd-reset`
- Blocked or drifting:
  - Phase 5 network / remote harbors
  - Phase 6 connectors / coaching
  - Phase 4E `pd self-test --adversarial` / 4F Windows IPC
- Open dogfood now: 3 slugs (`claim-preserving-git-safety`, `fleet-launchability-and-cadence`, `session-context-cwd-reset`)

## Recovery Radar

- Current phase: Recovery Track dominates; among V4 lanes, Phase 1 is still the busiest sidecar because graph / claim / symbolPath truth is actively moving.
- Velocity: 173 commits in the trailing 7-day window (2026-04-22 to 2026-04-28), 24.7/day.
- Closest to completion:
  - Port Daddy Website Generated Visual Replacement Slice
  - Port Daddy Website SEO Metadata And Discovery Slice
  - Shipwright Fleet UI Surface
- Blocked or drifting:
  - Phase 1 — Unified Edge Table / authority sync
  - Phase 2 — The Economy / economist follow-up
  - Phase 4A — Bun binary
- Open dogfood now: 2 entries — `fleet-launchability-and-cadence`, `session-context-cwd-reset`

### Cartographer Map Refresh (2026-04-28)

Current coordination session: `docs/ROADMAP.md`, `docs/V4-UNIFIED-ROADMAP.md`,
`docs/recovery/DOGFOOD-FEEDBACK.md`, and `.cartographer/status.md`.

- Reconciled the V4 roadmap, public roadmap, and cartographer status against
  the latest commit stream so the map matches the build instead of the stale
  March snapshot.
  - `pd feedback list --status open --json` was unavailable on this shell, so
    the raw `.spark/feedback/` harvest was the source of truth for this pass.
- Promoted `claim-preserving-git-safety`, `fleet-launchability-and-cadence`,
  and `session-context-cwd-reset` into `docs/ROADMAP.md`;
  `feedback-route-stable-gap` stayed backlog.
- Folded duplicate guard and roadmap-progress feedback back into
  `IDEAS-TROVE.md` provenance pointers instead of minting parallel slugs.

### Port Daddy Website Generated Visual Replacement Slice (2026-04-27)

Current coordination session: `session-a4b3a18d-1651-4d2b-b4ca-e83fb79b5ea3`.

- This is the next bounded `ideal-web-app-builder` rehab slice after the SEO
  metadata/discovery work. The user explicitly rejected the remaining sailor
  photo / rounded visual direction and provided a Gemini API key for generated
  content.
- Added `website-v2/scripts/generate-gemini-assets.mjs`,
  `npm run generate:visuals`, and `npm run optimize:visuals`. The generator
  loads `GEMINI_API_KEY` from the shell, repo-root `.env.local`, or
  `website-v2/.env.local`; secrets are not written to source or manifest. <!-- cite-exempt -->
- Generated and optimized four Gemini/Nano Banana visual assets under
  `website-v2/public/img/generated/` with manifest provenance:
  `control-plane-hero`, `control-plane-og`, `agent-runtime-map`, and
  `salvage-ledger`, each with JPEG plus WebP variants.
- Replaced the homepage hero image with the generated control-plane schematic,
  moved the hero two-column breakpoint to `min-[900px]` so the image appears in
  the in-app browser first viewport, and deleted the retired
  `website-v2/public/img/hero-portdaddy.png` asset. <!-- cite-exempt -->
- Default social metadata now uses `/img/generated/control-plane-og.jpg`.
  Blog fallback imagery now uses generated WebP page images instead of the
  retired sailor image or missing blog hero files.
- Touched legacy shape/copy surfaces were narrowed: hero chips and CTA buttons
  use smaller token radii, the CTA banner no longer says "harbormaster" or
  uses an anchor icon, `Badge` defaults are flatter and squared, and stale
  "neumorphic" comments in touched files were renamed to tokenized elevation
  language.
- Regression coverage: `src/seo-metadata.test.tsx` now asserts the default
  social image is generated and the retired sailor hero file is absent.
- Browser proof:
  `docs/reports/website-rehab-screenshots/generated-hero-homepage.png`.
- Validation truth on 2026-04-27 from `website-v2/`:
  - `npm run generate:visuals`: generated 4 assets with
    `gemini-3.1-flash-image-preview`
  - `npm run optimize:visuals`: optimized 4 generated assets
  - `npm run generate:seo`: generated SEO artifacts for 182 canonical routes
  - `npm run lint`: pass
  - `npm run test`: 8/8 files and 83/83 tests pass
  - `npm run build`: pass; largest generated JS chunk remains Mermaid at
    491.00 kB minified / 136.63 kB gzip
  - `npm run build-storybook`: pass with the known Storybook iframe-size and
    `radix-ui` package metadata warnings
  - root `npm test -- --no-coverage`: 153/153 suites passed, 5082/5083 tests
    passed, 1 intentional skip; existing console noise included git-probe,
    telemetry-bypass, keychain/plaintext fallback, and subscriber-error test
    logs
- Follow-on visual-metaphor cleanup: `NeumorphicTerminal` was renamed to
  `CommandTerminal`, the dashboard `SailorAgent` SVG was replaced with a
  rectilinear `AgentNodeMark`, and the live graph/home feature cards now use
  tighter token radii. The dashboard route also no longer uses the blurred
  circular hero glow, anchor iconography, or large rounded panel/status radii.
  Production source no longer references the old terminal or sailor component
  names.
- Live visual review follow-up: the homepage feature-card icon tiles that read
  as neon yellow on beige inset relief were removed. Feature cards now use
  numbered Swiss panels with border rules and category metadata instead of icon
  containers. The matching neon sparkle on the secondary CTA was also replaced
  with a blue arrow and a flat bordered button treatment, and the CTA's
  decorative inset icon block was removed. The fixed public shell header strip
  and active nav state now use brand-primary blue instead of neon accent. The
  hero headline's "fighting each other" emphasis also no longer uses a
  blue-to-error gradient; it now uses the existing brand-primary token with a
  contract test guarding against gradient text regression.
- Tutorials index branding has also been rewritten: the first viewport now uses
  "Operator training" and "Learn the control-plane protocol" instead of
  "Academy of Coordination" / "Master the Swarm Logic"; the index cards are
  flat numbered curriculum panels, and the catalogue titles/descriptions/tags
  avoid the retired swarm/pheromone/harbor-token marketing language.
- Whitepaper route branding has been rebuilt as an editorial research dossier:
  the first viewport now uses "The control-plane papers.", flat paper-selection
  controls, immediate paper metadata, and an argument-map/PDF layout instead of
  the old centered "White Papers" badge, inset icon tile, rounded selector
  cards, and large empty opening space. Header nav labels are also non-shrinking
  and the decorative right-edge header strip was removed after mobile screenshot
  proof showed it reading as a stray blue bar.
- Global relief enforcement has now moved into the shared system instead of
  page-by-page cleanup: all `--shadow-*` semantic tokens resolve to `none`,
  old `--shadow-neu-*` aliases and `.neu-*` utilities were removed, Surface,
  Button, and site-panel primitives render as flat framed planes, and the public
  stylesheet neutralizes legacy Tailwind `shadow-*` / `drop-shadow` utilities so
  old route code cannot visually reintroduce raised, inset, or glow treatments.
  The direct landing-page `neu-shadow`, brand glow, and SVG drop-shadow bypasses
  were also removed.
- Browser proof:
  `docs/reports/website-rehab-screenshots/whitepaper-first-viewport.png` and
  `docs/reports/website-rehab-screenshots/whitepaper-mobile-first-viewport.png`.
- Relief browser proof:
  `docs/reports/website-rehab-screenshots/flat-relief-home.png`,
  `flat-relief-tutorials.png`, `flat-relief-whitepaper.png`,
  `flat-relief-docs.png`, `flat-relief-dashboard.png`, `flat-relief-mcp.png`,
  `flat-relief-roadmap.png`, `flat-relief-blog.png`,
  `flat-relief-examples.png`, `flat-relief-integrations.png`,
  `flat-relief-cookbook.png`, and `flat-relief-blueprints.png`.
- Latest validation for this website route cleanup from `website-v2/`: focused
  `npm run test -- src/design-system-contracts.test.ts
  src/public-shell-contracts.test.ts` passes at 32/32 tests, full `npm run
  lint`, `npm run test` (8/8 files and 87/87 tests), `npm run build`, and root
  `git diff --check` all pass. Playwright route audit across twelve routes
  reports every `--shadow-*` token as `none` with zero real box shadows and
  zero drop shadows. The earlier Storybook pass still carries the known
  iframe-size and `radix-ui` package metadata warnings.
- Remaining website rehab work: route-specific OG image generation,
  PWA/favicons, legal/privacy/support/security-contact pages, observability/Web
  Vitals, claims ledger, broader rounded/glow route cleanup, and manual
  reduced-motion/forced-colors/screen-reader proof.

### Port Daddy Website SEO Metadata And Discovery Slice (2026-04-27)

Current coordination session: `session-7d6f4ac6-5c47-401d-853b-804be7eecbd6`.

- This is the next bounded `ideal-web-app-builder` rehab slice after the public
  shell unification work.
- The website now has a canonical source-backed metadata registry at
  `website-v2/src/data/siteMetadata.ts` covering 182 indexable public URLs.
  It draws from existing route/data truth for docs families, tutorials, blog
  posts, integrations, cookbook recipes, and templates.
- React Router now mounts `DocumentMeta`, which updates title, description,
  canonical URL, robots, Open Graph, Twitter card, article fields, tags, and
  JSON-LD on SPA navigation through the upgraded `useDocumentMeta` hook.
- `npm run generate:seo` now writes `public/sitemap.xml`, `public/robots.txt`, <!-- cite-exempt -->
  and `public/llms.txt` from that same registry. `npm run build` runs this as <!-- cite-exempt -->
  `prebuild` so checked-in discovery artifacts are regenerated before the
  production bundle.
- SEO tests now enforce unique canonical URLs, existing social image files,
  blog article metadata, generated sitemap/robots parity, LLM discovery
  entrypoints, and real document-head mutation.
- Validation truth on 2026-04-27 from `website-v2/`:
  - `npm run generate:seo`: generated SEO artifacts for 182 canonical routes
  - `npm run test -- src/seo-metadata.test.tsx`: 6/6 pass
  - `npm run lint`: pass
  - `npm run test`: 8/8 files and 82/82 tests pass
  - `npm run build`: pass; largest JS chunk remains Mermaid at 491.00 kB
    minified / 136.64 kB gzip
- Remaining website rehab work: prerender/static metadata for non-home routes,
  dedicated OG image generation beyond verified existing images, PWA/favicons,
  legal/privacy/support/security-contact pages, observability/Web Vitals,
  claims ledger, and manual reduced-motion/forced-colors/screen-reader proof.

### Promotion And Build-Artifact Hygiene (2026-04-27)

Current coordination session: `session-940abfb1-8d54-4058-a7c3-3515b3b921c7`.

- Local `main` was pushed to origin at `89f17ac` (`Constrain FleetBar popover content`).
- Canonical promotion via `./scripts/promote-stable.sh` passed `5025` tests with `0` failures and promoted stable through `65f2b4e` (`promote: main@89f17ac -> stable`).
- Live daemon truth after promotion: Port Daddy `3.11.0`, PID `13470`, `/health` `ok`, runtime `nominal`, install dir `/Users/erichowens/port-daddy-stable`.
- FleetBar was rebuilt, reinstalled, and launchd-kickstarted; the live FleetBar process is PID `14267`.
- Promotion exposed a stable-hygiene bug: `scripts/build-core.sh` built inside the tracked `core/harbor-card-rs/target/release/**` tree, dirtying the stable checkout after a successful promotion.
- The build script now builds the Rust FFI core through an external Cargo target directory (`PORT_DADDY_CORE_TARGET_DIR`, `CARGO_TARGET_DIR`, or a per-checkout temp path) before copying the shared library into `dist/core`.
- A follow-up promotion passed the same `5025`-test gate and promoted stable through `418a1d0`; the stable checkout is clean after the corrected build path.

### Promotion Recovery Closeout (2026-04-27)

Current coordination session: `session-e5ab0dfb-dadc-4d26-acd7-b38431d17d1e`.

- Stable promotion is complete and pushed after the guard parity, guard hook, stale-work visibility, release-surface docs, and promotion wait-loop slices landed.
- Remote `main` is `717f4f49bbb382851fe582b926ce88dc2f06b69f` (`717f4f4` — promotion verification wait-loop hardening).
- Remote `stable` is `40cf79d9f5846986fc6ed8ed696061fd2268a856` (`40cf79d` — `promote: main@717f4f4 -> stable`).
- Official promotion validation passed through `./scripts/promote-stable.sh` under `pd with-lock stable-promotion`: `147/147` Jest suites passed, `5019` tests passed, `1` test skipped, then stable build/install/runtime verification completed.
- Live daemon truth after promotion: `/version` reports Port Daddy `3.11.0`, code hash `ce3faf8fb34e`, PID `79768`, and install dir `/Users/erichowens/port-daddy-stable`; `/health` is `ok` with runtime `nominal`.
- The stable-promotion lock released; the remaining lock is the daemon-owned fleet project lease for `/Users/erichowens/coding/port-daddy`.
- Residual stable-checkout dirt remains under `core/harbor-card-rs/target/release/**`. Treat it as generated build residue from the stable checkout, not as source truth.
- Coordination truth is still degraded: `pd sessions --active` lists active sessions while `pd agents --active --json` returns zero. This was broadcast on `coordination:inconsistency`, sent to Coxswain, and recorded as tuple `7450`.
- The promotion state was recorded as tuple `7449`; Harbormaster was messaged that promotion was incomplete until stable included `717f4f4` and remote `stable` moved. That condition is now satisfied.

### Stale Work Visibility And Actor Inbox Triage (2026-04-27)

Current execution session: `session-3c9f287b-3b90-493e-b867-7dff73136071`.

- This slice intentionally avoided the runtime/backend files that were active under the Claude SDK / cartographer launchability work.
- `pd salvage --project port-daddy --summary` now exposes the stale/dead queue as non-live triage: status counts, age buckets, project scope, encrypted-note redaction count, and a direct comparison hint for `pd sessions --active` / `pd agents --active`.
- Encrypted note blobs in salvage output are now redacted instead of flooding the terminal with ciphertext. The current dogfood read showed 54 non-live `port-daddy` entries, 40 encrypted notes redacted, 4 entries under 2 hours, 43 from 2-24 hours, and 7 over 24 hours.
- Actor inbox triage now has an explicit acknowledgement path: `pd actor <id> --inbox --mark-read` calls `PUT /actors/:id/inbox/read-all` after printing messages. This marks messages read without deleting them.
- The Navigator inbox was inspected but not acknowledged in this slice. It currently has 6 unread messages, including roadmap/promotion coordination requests that should stay durable until the responsible roadmap actor or operator intentionally marks them read.
- Validation truth: `npm test -- tests/unit/salvage-visibility.test.js tests/unit/actors-routes.test.js --runInBand` passed 2 suites / 7 tests; `npm run typecheck` passed; `git diff --check` passed; source CLI dogfood for `pd salvage --summary`, `pd actor navigator --inbox-stats`, and `pd actor navigator --inbox --unread --limit 2` succeeded.
- Follow-up dogfood after stable promotion showed `pd salvage --summary --project port-daddy` at 57 non-live queue entries, all pending: 6 under 2 hours, 44 from 2-24 hours, and 7 over 24 hours, with 60 encrypted notes redacted from CLI output.

### Port Daddy Skill And Actor-Truth Repair (2026-04-26)

Original execution session: `session-a7366433-5e18-4deb-b78a-561b77163e23`.
Continuation merge/UI honesty session: `session-d50ed49e-60b5-4e0a-8387-50884f127176`.

- The active request is to use `skill-architect` to repair the confusing/out-of-date agent skill and improve skill governance across the repo.
- Live actor truth was verified: `pd actor cartographer` resolves to the durable `navigator` actor, whose mission covers roadmap, recovery-ledger, work-slices, and cartographer-status. `pd actor lookout` is the release-surface owner for docs/API/skills/product truth.
- `pd actor --message` queues durable mailbox work; it is not an immediate answer. Agents still need to read live Port Daddy state and authority docs when no live body responds.
- `skills/port-daddy-agent-skill/SKILL.md` now has first-party metadata and an explicit roadmap/skill actor workflow before MCP/reference material.
- `skills/port-daddy-agent-skill/SKILL.md` and `AGENTS.md` now encode the ambient-collaboration policy: agents should publish structured scope/evidence; durable actors/watchers should call out material inconsistencies; no forced constant peer chat.
- The policy now explicitly includes goal/invariant-level inconsistency detection: security/auth/privacy/trust-boundary/API-shape drift, product/UX direction mismatch, and strong inferred operator goals. Example: a raw text API should be flagged if adjacent work indicates authenticated secure API expectations, even when the raw endpoint is not locally broken.
- Live coordination evidence exposed a gap worth fixing next: `/operator/actors` can show active sessions as stale/salvaged while `pd sessions --active` still lists them, and `pd agents --active` can return zero. That should be surfaced as a coordination inconsistency instead of leaving the operator to reconcile it manually.
- A worktree-scoped `coordination:inconsistency` channel now exists. Tuple `6213` records the default policy for operator-worthy cross-agent conflicts, and tuple `6249` records implied-goal inconsistency detection.
- `tests/unit/port-daddy-skill-authority.test.js` now guards first-party skill metadata and the live actor consultation path.
- `skills/port-daddy-agent-skill/CHANGELOG.md` records this skill-surface mutation.
- `scripts/audit-skills.mjs` now provides deterministic JSON/Markdown governance scanning for every visible repo skill; current scan sees 109 skills, 70 missing at least one of `license`, `allowed-tools`, or `metadata`, 4 first-party skills, and 19 imported-literature skills.
- `docs/reports/SKILL_GOVERNANCE_AUDIT_2026-04-26.md` records the broader audit and warns not to blindly rewrite imported/research skills.
- The validated `port-daddy-agent-skill` skill and references were mirrored into `/Users/erichowens/.agents/skills/port-daddy-agent-skill/` so new agents can load the updated instructions.
- The workgroup `port-daddy` skill has now received an adapted merge at `/Users/erichowens/coding/workgroup-ai/skills/port-daddy/`: it keeps the workgroup package name, gains the current repo/user runbook body, gets a changelog entry, and has references mirrored from `skills/port-daddy-agent-skill/references/`.
- Skill diff honesty: the repo and user installed `port-daddy-agent-skill` skills were identical at 729 lines, while the workgroup `port-daddy` skill was an older 409-line surface with a 546-line diff against the repo copy; its API reference was also stale by 755 diff lines and its SDK reference by 49 diff lines.
- UI honesty: Fleet Control Center already used the coordination substrate generically through actors, channels, tuples, graph, and memory views, but it did not first-class the new `coordination:inconsistency` layer. `fleet-config-ui` now surfaces project-level coordination inconsistency callouts from that channel and jumps the operator into the channel when opened. Native FleetBar still only benefits indirectly through the embedded control plane/actor lens; a native popover alert remains future work.
- Validation truth: `npm test -- tests/unit/port-daddy-skill-authority.test.js tests/unit/skill-governance-audit.test.js --runInBand` passed 2 suites / 9 tests; `pd fleet validate` passed with no topology warnings; `git diff --check` passed; `npm run build` from `fleet-config-ui/` passed with the existing large-chunk warning.

### Shipwright Fleet UI Surface (2026-04-26)

Shipwright is now visible in the real Fleet Control Center instead of only in
docs and previews. Current execution sessions: `session-07535f5d-ff36-45c0-8d0f-ce2cad1e5575`
for the UI slice and `session-605add56-8e29-4c82-acb6-faa38566eaf0` for this
status handoff.

- `2cc9fee` rebuilt the served `public/fleet-ui` bundle after the Shipwright
  grammar/API/fixture slice landed.
- `f689337` adds a `Shipwright` top-level surface to `fleet-config-ui`, with an
  all-project route at `/fleet-ui/?surface=shipwright` and project-scoped render
  when a project is selected.
- The first visible panel is fixture-backed by design until `/shipwright/*`
  daemon routes exist. It renders Harbor survey truth, proposed agents with
  deterministic ship thumbnails, simulation events, budget/escrow summaries,
  and Shipwright chat copy with visible fixture labels.
- Validation truth on 2026-04-26:
  - `npm run lint` from `fleet-config-ui/`: green
  - `npm run build` from `fleet-config-ui/`: green with the existing large
    Fleet UI chunk warning
  - `npm test -- tests/unit/ship-grammar.test.ts --runInBand`: 6/6 pass
  - browser smoke via Vite + Chromium CDP: desktop and narrow viewport render
    the Shipwright surface at `?surface=shipwright&daemon=http://127.0.0.1:9876`
  - broad `npm test`: 143/143 suites pass, 4981/4982 tests pass, 1 intentional
    skip
- Remaining Shipwright UI work: split the monolithic panel into the planned
  `HarborView`, `FocusView`, `SimulationView`, and `FleetControlView`; add
  query-param subview state; wire real `/shipwright/*` daemon routes once they
  exist; then promote the bundle through the normal stable path.

### Port Daddy Website Ideal-Web-App Rehab Handoff (2026-04-24)

The active public-site thread is now an `ideal-web-app-builder` rehabilitation
handoff for `website-v2`, not another broad replacement reset.

- New authority plan: `docs/plans/port-daddy-website-ideal-web-app-rehab.md`
- Visual decision board: `docs/plans/port-daddy-website-visual-decision-board.md`
- Screenshot baseline: `docs/reports/website-rehab-screenshots/`
- Port Daddy session used for the handoff: `session-80296aef-bf46-4457-b900-b7c9ca9c92fe`
- Baseline truth:
  - `npm run build` passes, but warns on a 1.99 MB main chunk
  - `npm run build-storybook` passes, but warns on a 1.08 MB iframe chunk
  - `npm run test` fails in `src/data/tutorials.test.ts` because tutorial order, totals, prev/next, title, numeric prop, and orphan route truth have drifted
  - `npm run lint` fails on real source issues and because ignored `storybook-static` output is still in the lint scope
- Do not start broad visual or route rewrites until the user approves or amends
  the visual decision board.
- The recommended direction is signal-grade infrastructure editorial: preserve
  the distinct paper/ink/blue/lime identity, normalize it into a three-layer
  token contract, repair tests/lint first, then rebuild the high-drift MCP page
  as the first proof slice.

### Port Daddy Website First Stabilization Slice (2026-04-26)

The user approved moving forward from the static visual decision board. Current
execution session: `session-1a8459c2-808f-4564-ab9d-c5be56fa86bb`.

- Tutorial route truth is repaired while preserving the broad route surface:
  `/tutorials/semantic-identities` is now canonical, the series has 20 lessons,
  all page numbers/totals/prev-next links align, and `TutorialProgress` derives
  from `src/data/tutorials.ts` instead of a duplicate hardcoded list.
- Generated `storybook-static` output is now excluded from website lint.
- The real source lint gate is green after fixing fast-refresh export
  boundaries, React Compiler set-state-in-effect cases, render-time random
  animation delays, stale Mermaid lint suppression, loose dashboard/viz/page
  types, and no-useless markdown escapes.
- Validation truth on 2026-04-26 from `website-v2/`:
  - `npm run lint`: green
  - `npm run test -- src/data/tutorials.test.ts`: 35/35 pass
  - `npm run test`: 7/7 files and 69/69 tests pass
  - `npm run build`: green with the known large-main-chunk warning
  - `npm run build-storybook`: green with the known large iframe chunk and
    `radix-ui` package metadata warnings
- Remaining website rehab blockers are explicit, not hidden: the main app chunk
  is still about 1.99 MB minified / 532 kB gzip, token layers are not yet split,
  MCP mobile contrast remains the first visual proof-slice target, and
  Storybook/a11y/SEO/PWA/legal/privacy/observability work remains future
  product-readiness scope.

### Port Daddy Website Token/Performance Slice (2026-04-26)

Follow-on execution session: `session-c2085e79-36d0-4898-9cc5-90c4f60aef3a`.

- The website token entrypoint now imports three explicit layers:
  `tokens.source.css`, `tokens.semantic.css`, and `tokens.roles.css`.
- Compatibility role aliases remain in place so legacy route modules can
  migrate in bounded visual slices.
- `website-v2/src/main.tsx` now lazy-loads route modules behind a shared
  `RouteFallback` status primitive instead of statically importing the entire
  page/docs/tutorial tree into the app entry.
- `website-v2/vite.config.ts` now isolates the heavy React, Motion, Markdown,
  Mermaid, Three, and react-force-graph families without creating one giant
  vendor chunk.
- Contract tests now enforce token import order, protected-module color-literal
  discipline, and route lazy loading.
- Validation truth on 2026-04-26 from `website-v2/`:
  - `npm run lint`: green
  - `npm run test -- src/design-system-contracts.test.ts`: 9/9 pass
  - `npm run test`: 7/7 files and 72/72 tests pass
  - `npm run build`: green with no chunk-size warning; largest JS chunk is
    `Mermaid-CMXUcArO.js` at 491.12 kB minified / 136.65 kB gzip, and the app
    shell chunk is `App-Bp-5vPKf.js` at 20.43 kB minified / 6.80 kB gzip
- Remaining website rehab blockers: MCP mobile contrast and visual drift, raw
  visual literals in unprotected legacy pages, Storybook/a11y/SEO/PWA/legal/
  privacy/observability, and a deeper Mermaid/diagram payload decision.

### Port Daddy Website MCP Proof Route Slice (2026-04-26)

Follow-on execution session: `session-4174ea2d-db24-4af2-a2d4-d9be7421a26c`.

- `/mcp` is now rebuilt on the approved shared public-site primitives instead
  of the prior ad hoc MCP/provider-color surface.
- The route now composes `PageContainer`, `SectionIntro`, `SurfacePanel`,
  `PanelTitle`, `PanelBody`, `BracketLabel`, `BracketLink`, and
  `DocsCodeBlock`, with tokenized role/semantic colors and no raw route-level
  color literals.
- The CLI/MCP/SDK/REST pub/sub surface now uses explicit `tablist`, `tab`, and
  `tabpanel` semantics.
- Invalid comma-separated Tailwind arbitrary grid tracks on the MCP route were
  replaced with space-separated `minmax(0, ...)` tracks; this restored the
  intended desktop two-column proof layout.
- Shared public primitives and code blocks now include shrink-safe
  `min-w-0`/`max-w-full` behavior so wide code samples scroll inside their
  blocks instead of widening mobile pages.
- Proof screenshots now exist at:
  - `docs/reports/website-rehab-screenshots/mcp-proof-desktop.png`
  - `docs/reports/website-rehab-screenshots/mcp-proof-mobile.png`
- Validation truth on 2026-04-26 from `website-v2/`:
  - `npm run lint`: green
  - `npm run test -- src/design-system-contracts.test.ts`: 10/10 pass
  - `npm run test`: 7/7 files and 73/73 tests pass
  - `npm run build`: green with no chunk-size warning; largest JS chunk is
    `Mermaid-NIUzfny0.js` at 491.12 kB minified / 136.66 kB gzip, and the MCP
    route chunk is `MCPPage-Cs0vR24E.js` at 18.62 kB minified / 6.08 kB gzip
- Remaining website rehab blockers: Storybook state matrix, axe/keyboard and
  manual a11y evidence, SEO/OG/PWA/legal/privacy/observability, raw visual
  literals in legacy pages outside the protected contract, and a deeper
  Mermaid/diagram payload decision.

### Port Daddy Website Swiss-Modern Grid Layer Slice (2026-04-26)

Follow-on execution session: `session-d43caa83-9525-4a04-a1b4-57df1ef92916`.

- The local `swiss-modern-website-design` skill was used as the design lens for
  this slice. The implementation is an overlay on the Port Daddy identity, not
  a grayscale replacement: keep paper/ink/blue/lime, but make the grid,
  measure, typography, and surface depth stricter.
- The Swiss-modern audit against `website-v2` reported remaining drift:
  219 literal color instances, 145 unique literal colors, 203 radius patterns,
  121 shadow patterns, and 185 width patterns.
- Source and role tokens now include a formal grid/measure layer:
  `--layout-grid-columns`, `--layout-grid-gap`, `--layout-copy-measure`,
  `--layout-caption-measure`, `--layout-meta-measure`, `--grid-*`, and
  `--measure-*`.
- Shared elevation tokens are flatter (`--shadow-raised`, `--shadow-sm`, and
  `--shadow-pressed`) so the public shell reads more like editorial
  infrastructure and less like a stack of decorative cards.
- `website-v2/src/components/site/primitives.tsx` now exports `SwissGrid` and
  `SwissGridItem` for 12-column desktop composition with a mobile-safe
  single-column collapse.
- The public primitive Storybook story now demonstrates the Swiss grid contract.
- `/mcp` now uses the Swiss grid for the proof route: 7/5 hero composition,
  3/9 rail/body sections, and 6/6 or 7/5 proof sections while preserving mobile
  wrapping.
- Proof screenshots now exist at:
  - `docs/reports/website-rehab-screenshots/mcp-swiss-desktop.png`
  - `docs/reports/website-rehab-screenshots/mcp-swiss-mobile.png`
- Validation truth on 2026-04-26 from `website-v2/`:
  - `npm run lint`: green
  - `npm run test -- src/design-system-contracts.test.ts`: 10/10 pass
  - `npm run test`: 7/7 files and 73/73 tests pass
  - `npm run build`: green with no chunk-size warning; largest JS chunk is
    `Mermaid-C7kUbfif.js` at 491.12 kB minified / 136.65 kB gzip, and the MCP
    route chunk is `MCPPage-BRPJpuq-.js` at 18.66 kB minified / 6.12 kB gzip
  - `npm run build-storybook`: green with the known large iframe chunk warning
    and `radix-ui` package metadata warning
- Remaining website rehab blockers: broader route migration to the Swiss grid,
  Storybook state matrix, axe/keyboard/manual a11y evidence, SEO/OG/PWA/legal/
  privacy/observability, raw visual literals in legacy pages, and a deeper
  Mermaid/diagram payload decision.

### Port Daddy Website Storybook and MCP A11y Slice (2026-04-26)

Follow-on execution session: `session-38334c91-8bed-45d4-85be-da069cd41648`.

- Storybook a11y is now configured to run axe through `wcag2aaa` plus
  `color-contrast-enhanced`, matching the stricter MCP route gate instead of
  silently stopping its label at AA.
- The public primitive Storybook matrix now participates in the design-system
  contract alongside Button, Badge, Surface, CodeBlock, and the MCP route
  story.
- The MCP pub/sub tabs now declare vertical tablist orientation and are covered
  by contract checks for roving tab index, ArrowDown/ArrowRight/Home/End
  navigation, and visible focus.
- Refreshed a11y evidence now lives at
  `docs/reports/website-rehab-a11y/mcp-a11y-report.json`; it records 0 desktop
  axe violations, 0 mobile axe violations, 4 tabs, visible focus outline, and
  no horizontal overflow at 1440x1200 or 390x1200.
- Validation truth on 2026-04-26 from `website-v2/`:
  - `npm run lint`: green
  - `npm run test -- src/design-system-contracts.test.ts`: 11/11 pass
  - `npm run test`: 7/7 files and 74/74 tests pass
  - `npm run test:a11y:mcp`: green with refreshed report/screenshots
  - `npm run build`: green with no chunk-size warning; largest JS chunk is
    `Mermaid-CMec62CS.js` at 491.12 kB minified / 136.65 kB gzip, and the MCP
    route chunk is `MCPPage-Cqgjlo-C.js` at 19.34 kB minified / 6.39 kB gzip
  - `npm run build-storybook`: green with the known large iframe chunk warning
    and `radix-ui` package metadata warning; iframe is 1,087.59 kB minified /
    307.00 kB gzip
- Remaining website rehab blockers: route-wide a11y/manual screen-reader
  evidence, route-composite Storybook matrices, SEO/OG/PWA/legal/privacy/
  observability, raw visual literals in legacy pages, and a deeper
  Mermaid/diagram payload decision.

### Port Daddy Website Public Shell Unification Slice (2026-04-26)

Follow-on execution session: `session-652f982e-46f1-404c-a6d2-417b1eb2e7f5`.

- Home now renders through `MainLayout` and the shared `SiteHeader`; the old
  `components/landing/Nav` shell was removed.
- `components/layout/Footer.tsx` now re-exports `SiteFooter`, so older layout
  callers converge on the shared footer primitive.
- `SiteHeader` now carries the shared shell identity
  `header[data-shell="site-header"]`, an always-present skip link, desktop docs
  search, mobile search trigger, active route styling, tokenized focus
  treatment, and shared `PageContainer` sizing.
- Route-level top padding was removed from public pages that now sit beneath
  the normal document-flow shell.
- `TerminalDemos` was fixed for mobile shrink safety after the shell a11y gate
  caught horizontal overflow in the tab rail and terminal column.
- Contrast-critical token fixes landed in the system layer:
  - code identity highlighting uses `--code-channel-*` tokens
  - Badge variants use high-contrast on-tint tokens
  - lime/accent foreground-muted tokens now satisfy the strict route gate
  - dimmed `DocsCard` eyebrow opacity was removed
  - `BlogPage` feature badges no longer use raw color literals
- `scripts/check-public-shell-a11y.mjs` and `npm run test:a11y:shell` now <!-- cite-exempt -->
  audit `/`, `/docs`, `/mcp`, and `/blog` at desktop and mobile sizes for shell
  structure, visible first-tab skip-link focus, horizontal overflow, screenshots,
  WCAG tags through AAA, and `color-contrast-enhanced`.
- Refreshed shell evidence lives at
  `docs/reports/website-rehab-a11y/public-shell-a11y-report.json` and:
  - `docs/reports/website-rehab-screenshots/shell-home-desktop.png`
  - `docs/reports/website-rehab-screenshots/shell-home-mobile.png`
  - `docs/reports/website-rehab-screenshots/shell-docs-desktop.png`
  - `docs/reports/website-rehab-screenshots/shell-docs-mobile.png`
  - `docs/reports/website-rehab-screenshots/shell-mcp-desktop.png`
  - `docs/reports/website-rehab-screenshots/shell-mcp-mobile.png`
  - `docs/reports/website-rehab-screenshots/shell-blog-desktop.png`
  - `docs/reports/website-rehab-screenshots/shell-blog-mobile.png`
- Validation truth on 2026-04-26 from `website-v2/`:
  - `npm run lint`: green
  - `npm run test -- src/design-system-contracts.test.ts`: 13/13 pass
  - `npm run test`: 7/7 files and 76/76 tests pass
  - `npm run test:a11y:shell`: green with 0 axe violations and no horizontal
    overflow across the four-route desktop/mobile matrix
  - `npm run test:a11y:mcp`: green with refreshed report/screenshots
  - `npm run build`: green with no chunk-size warning
  - `npm run build-storybook`: green with the known large iframe chunk warning
    and `radix-ui` package metadata warning
- Remaining website rehab blockers: route-internal composite cleanup,
  manual screen-reader/reduced-motion/forced-colors passes, route metadata and
  OG images, PWA/favicons, legal/privacy/support pages, observability, claims
  ledger, and deeper payload budgets.

### Cartographer / Navigator Maritime Actor Foundation (2026-04-26)

The current actor slice rebuilds the missing foundation that recovery docs had
already started referencing. Cartographer is now modeled as the compatibility
fleet name for the durable `navigator` actor:

- `docs/adr/0022-durable-actor-souls-and-body-leases.md` defines the governing actor split: durable actor souls persist, body leases carry live mutation authority.
- `docs/adr/0023-cartographer-roadmap-actor.md` defines the target actor: durable identity, mailbox, roadmap/work-slice read model, tuples, graph edges, and evidence links across docs, sessions, claims, commits, tests, and promotion attempts.
- `.cartographer/README.md` now defines the operating contract for bootstrap reconciliation, document authority classes, tuple vocabulary, graph vocabulary, and patch policy.
- `lib/maritime-actors.ts` defines the canonical maritime actor roster and projects live body, recent session, and salvage evidence from existing daemon state. <!-- cite-exempt -->
- `routes/actors.ts` exposes `GET /actors`, `GET /actors/:id`, and `POST /actors/:id/message`; `cartographer` currently resolves to `navigator`, and actor messages queue to `actor:<id>` inbox targets without granting dormant actors live mutation authority.
- `pd actors` and `pd actor <id-or-alias>` expose the directory in the CLI; `--inbox` and `--inbox-stats` expose durable mailbox state separately from live-body wake status.
- `PortDaddy` SDK clients now have `listActors()`, `getActor()`, `messageActor()`, `actorInboxList()`, and `actorInboxStats()` helpers, with SDK reference docs and request-formation regression coverage.
- README, completions, `features.manifest.json`, `docs/openapi.yaml`, MCP, and the Port Daddy skill API/SDK references now know about the new actor and actor-inbox surfaces.
- The initial batch step is explicitly a report-first reconciliation pass. It inventories and classifies extant documents, extracts work items and evidence, emits structured state, and proposes cleanup patches. It must not blindly rewrite every document.
- The sibling systems discussed in this thread are also actor-shaped and now have canonical maritime names: Navigator for roadmap/recovery state, Coxswain for claims/locks/stale work, Signalman for validation evidence, Harbormaster for promotion readiness, Sounder for semantic graph/synonymy, Lookout for docs/API/skill drift, Breaker for failure propagation, Caulker for robustness repair, and Quartermaster for cost/resource governance. They should all become durable actors with deterministic projectors and optional LLM bodies.
- Validation truth on 2026-04-26: focused actor + SDK + MCP + parity bundle is green at `551/551`, and `npm run typecheck` / `npm run build` are green. Broad `npm test -- --no-coverage` reached green counts at `142/142` suites and `4973/4974` tests with `1` intentional skip, then hit the known Jest open-handle warning; the hung `--no-coverage` process tree was cleaned up manually.

### Promotion-Gated Release Surface Review (2026-04-26)

The promotion script is now the high-signal trigger for docs/website/SDK/CLI/tutorial/README/skill drift work:

- `scripts/emit-promotion-release-review.mjs` builds a structured promotion review payload, writes a harbor-scoped `promotion:release-surfaces` tuple, and publishes the same payload on the `promotion:release-surfaces` channel. <!-- cite-exempt -->
- The payload filters generated/build artifact paths, carries changed-file counts, and truncates the file list so promotion review cannot accidentally shove stable archaeology through pub/sub.
- `scripts/promote-stable.sh` emits that review after the test gate passes and before merging `main` into stable. <!-- cite-exempt -->
- The trigger is intentionally not a direct spawn. Fleet policy owns activation through the `documentarian` agent, which now listens to `promotion:release-surfaces` with singleton, cooldown, dedupe, and backoff controls.
- `PORT_DADDY_PROMOTION_REVIEW_REQUIRED=1` makes emission failures block promotion; `PORT_DADDY_PROMOTION_REVIEW_ONLY=1` stops after signaling so release-surface agents can work before stable moves.
- The contract is covered by `tests/unit/promotion-release-review.test.js`. <!-- cite-exempt -->
- Validation truth on 2026-04-26: focused promotion/fleet tests are green, `npm run typecheck` and `npm run build` are green, source `pd fleet validate` reports no topology warnings, and broad `npm test -- --no-coverage --runInBand` is green at `143/143` suites and `4980/4981` passing tests with `1` intentional skip.

### Port Daddy Skill Happy Path Polish (2026-04-26)

The distributed `port-daddy-agent-skill` skill now starts as an agent runbook instead of
a feature catalog:

- frontmatter now names the default command path directly
- the first section is `Default Agent Happy Path`: `pd status`, `pd briefing`, optional `pd salvage`, `pd begin`, `pd advise`, `pd note`, file/symbol claims, result note, and `pd done`
- a small decision table explains when to branch to ports, locks, tuples, inbox/actors, sitrep, delegation, integration signals, and DNS
- advanced surfaces remain documented, but below the runbook and explicitly marked non-default
- `tests/unit/port-daddy-skill-authority.test.js` now asserts the happy path exists, is ordered, and stays before advanced/reference material
- Validation truth on 2026-04-26: focused skill authority and distribution freshness tests are green (`54/54`).

### Tree-Sitter Symbol Refresh From Repo Events (2026-04-24)

The current uncommitted runtime slice makes tree-sitter symbol indexing event-driven instead of requiring manual `/symbols/parse` calls:

- `server.ts` now passes the live `symbolIndex` into the fleet daemon.
- `lib/fleet-daemon.ts` subscribes managed projects to project-scoped `git:committed` messages and debounced source-file watcher events, then refreshes only supported in-project code files (`ts`, `tsx`, `js`, `jsx`, `mjs`, `cjs`, `py`).
- The daemon subscribes to both the fleet-config-name scoped channel and the repo-basename hook channel because the current hook computes scope from `basename(projectDir)` while this repo's fleet name is `port-daddy-dev`.
- New regression coverage in `tests/unit/fleet-daemon.test.js` proves hook-style commit payloads and source watcher events refresh symbols while ignoring docs, generated directories, and outside-project paths.
- Validation truth: focused `npm test -- tests/unit/fleet-daemon.test.js` is green, `npm run typecheck` is green, and broad `npm test` is green at `132/132` suites and `4816/4817` passing tests with `1` intentional skip.
- Runtime caveat: the live daemon must be rebuilt/relaunched/promoted before this dogfood path is active in the canonical runtime.

### Compass Coordination Advisor (2026-04-26)

The current working tree now has a first deterministic suggestibility slice for humans and agents:

- `lib/advisor.ts` evaluates session context, active file claims, symbol-index freshness, stale salvage, declared channels, tuple-worthy task language, and true lock candidates.
- `routes/advisor.ts` exposes `GET /advisor` and `POST /advisor`.
- `pd advise`, `pd preflight`, and `pd compass` call the advisor and render executable recommendations.
- MCP now exposes `coordination_preflight` as an essential tool so agents can ask Port Daddy what coordination primitives to use before editing.
- The slice is deterministic first: every recommendation carries `why`, `risk`, `evidence`, confidence, and one or more executable actions. LLM ranking/explanation remains future work.
- While dogfooding claims, this slice exposed and fixed a real zombie-asset bug: `claimFiles()` could add invisible-but-conflicting claims to inactive sessions, `getFileConflicts()` could report unreleased rows from inactive sessions, and `setPhase()` could move terminal sessions back to nonterminal phases without restoring status. `lib/sessions.ts` now rejects inactive-session claims, ignores inactive rows in conflict checks, and keeps terminal phase/status coherent; `tests/unit/sessions.test.js` covers these failure states.
- Validation truth on 2026-04-26: focused `sessions` + advisor/parity tests are green (`572/572`), and `npm run typecheck` is green. Broad `npm test -- --no-coverage` reached green counts at `139/139` suites and `4919/4920` passing tests with `1` intentional skip, then hung after Jest's open-handle warning.
- Teardown caveat: the broad-run exit blocker is an integration test harness process tree (`jest -> tsx -> server.ts`) on a surface actively claimed by `session-c4cc1a46-77ba-4c72-85cf-9ce13637cc97` / `agent-e802a389` (`tests/helpers/global-teardown.js`, `tests/helpers/ephemeral-daemon.js`). Compass recorded tuple `5474`, inboxed that agent, cleaned up its own hung PIDs, and did not edit across that active claim.
- Runtime caveat: the canonical daemon must be rebuilt/relaunched/promoted before this advisor surface is live in operator truth.

## Ledger Drift Correction (2026-04-12)

The ledger had fallen behind the actual branch state. Current committed truth is:

- `f45b751` — Fix CLI typecheck debt for sessions and tuples
- `8cddbca` — Add git-sensitive channel discovery
- `8236119` — Import curated workgroup-ai skills
- `0f77491` — Fix cost tracker migration for stable daemon
- `175210f` — Enforce fail-closed spawn telemetry by default
- `278fa47` — Fix with-lock option separator parsing
- `961a41c` — Add tunnel TTL and orphan cleanup safeguards
- `4765090` — Fix tunnel startup timeout leak

Validation truth as of 2026-04-12:

- `npm run typecheck` is green again after `f45b751`; older notes below about broad CLI/client/IPC typecheck debt are now historical, not active.
- broad `npm test` is green at `117/117` suites and `4662/4663` passing tests with `1` intentional skip.
- focused `npm test -- --runInBand --detectOpenHandles tests/integration/cli.test.js tests/unit/current-context.test.js` is green with no open-handle report.
- the older parallel worker-force-exit warning was not reproduced in the latest broad run or the focused handle hunt above, so that debt should now be treated as stale until reproduced again.

Newest active uncommitted slice:

- recovery-ledger reconciliation plus integration-context isolation hardening in:
  - `docs/recovery/CURRENT-WORK.md`
  - `.cartographer/status.md`
  - `tests/helpers/integration-setup.js`
  - `tests/integration/cli.test.js`
- the CLI integration harness now writes current-context through an explicit isolated helper and clears isolated context state after each test, instead of relying on implicit process-env side effects.
- new regression coverage now asserts those integration-context writes stay out of repo-local `.portdaddy/contexts/<slot>.json`.

The live recovery thread has split into two coupled slices:

1. Keep the operator loop truthful so one daemon, one fleet runtime, one control plane, and one native companion all tell the same story.
2. Capture the newer uncommitted semantic-memory slice honestly instead of pretending Phase 1 / memory work is still dormant.

Latest committed slice: `6d136cc` — Harden sugar session fallback and filepath locks.
Current uncommitted slice: IPC lock lifetime fix plus isolated IPC regression coverage for filepath locks:
- `server.ts` no longer auto-releases every lock owned by an agent when an IPC socket disconnects; the SDK uses short-lived IPC request clients for lock operations, so transport teardown is not valid ownership loss
- `tests/helpers/ephemeral-daemon.js`, `tests/helpers/global-setup.js`, `tests/helpers/global-teardown.js`, and `tests/helpers/integration-setup.js` now expose an isolated ephemeral `ipcPath` (plus isolated HOME for CLI IPC coverage) so integration tests can exercise real IPC without leaking onto the operator's canonical daemon
- `tests/integration/cli.test.js` now proves that owner-driven IPC lock acquisition on a filepath remains exclusive across separate CLI invocations and unlocks cleanly afterward
- validation truth on 2026-04-11:
  - focused `tests/integration/cli.test.js` + `tests/unit/locks.test.js` are green
  - broad `npm test` is green at `114/114` suites and `4616/4617` passing tests with `1` intentional skip
  - the older parallel Jest worker-force-exit warning still remains, so this slice fixed lock lifetime truth but not the residual suite teardown debt

Previous committed slice retained for context: `df4c351` — Track session region claims by symbol path.
Current uncommitted slice: direct-mode and implicit note/whoami scoping hardening after live stale-context drift:
- `bin/port-daddy-cli.ts` now validates repo-local current context against the direct DB before `pd note --direct` reuses an implicit session/agent scope
- `cli/commands/sessions.ts` now validates repo-local current context against the active backend before implicit `pd note` scoping, so stale local context falls back to the normal closed-fail path instead of surfacing `session ... not found`
- `lib/db.ts` now matches the committed `session_files.symbol_path` schema so fresh direct-DB initialization stays in sync with the committed session-claim model
- `lib/sugar.ts`, `routes/sugar.ts`, `lib/client.ts`, and `cli/commands/sugar.ts` now let `pd whoami` fall back to an explicit active `sessionId` when the agent row has already been reaped, instead of falsely declaring the operator inactive just because the weaker registry key disappeared first
- the same `lib/sugar.ts` slice also fixes explicit `done(agentId + sessionId)` ownership checks to use the actual camelCase session field, and `/sugar/done` now returns `409 SESSION_OWNERSHIP_MISMATCH` instead of collapsing that path into a generic `500`
- validation truth on 2026-04-11:
  - `tests/integration/direct-mode.test.js` is green again
  - focused `client` / `sugar` / CLI integration regressions covering stale-agent `whoami` and explicit-session ownership are green
  - full `npm test` was green at `114/114` suites and `4611/4612` passing tests with `1` intentional skip when this slice landed; newer validation is now above
  - `npm run typecheck` is still red, but the failures are the same broader pre-existing CLI/client/IPC typing debt family rather than a new regression from this slice

Newest committed semantic-claim slice now on `HEAD`:
- `lib/sessions.ts` / `routes/sessions.ts` / `tests/unit/region-claims.test.js` now carry canonical `symbolPath` claim identity with line-range fallback
- current `HEAD` also includes `30737e0` (`Enforce public repo boundary for local residue`), so recovery docs that still describe symbol-backed claim authority as future work are now wrong

Still-active larger uncommitted slice: tuple-first coordination and semantic graph harmonization:
- new durable graph surface: `lib/graph-edges.ts`, `routes/graph.ts`, `tests/unit/graph-edges.test.js`
- new episodic memory surface: `lib/episodic-memory.ts`, `routes/memory.ts`, `tests/unit/episodic-memory.test.js`
- new operator UI surface: `fleet-config-ui/src/components/MemoryPanel.tsx` plus FleetBar route/tab wiring
- tuple space is now a real coordination substrate instead of a side primitive:
  - `lib/fleet-engine.ts` accepts `trigger_tuple` in fleet YAML, drains tuple mailboxes as launch inputs, and emits semantic alias tuples from fleet work items
  - `lib/fleet-daemon.ts` projects fleet lifecycle into `fleet:event` tuples so downstream systems can consume run truth without scraping logs or channels
  - `lib/merge-queue.ts` projects merge lifecycle into `merge:event` tuples and emits semantic alias tuples from branch / claim / task metadata
  - `lib/episodic-memory.ts` projects remembered episodes into `memory:episode` tuples and semantic alias tuples
- integration glue now writes graph/memory truth from existing systems:
  - `lib/symbol-index.ts` writes file/symbol/dependency edges
  - `lib/merge-queue.ts` writes merge-entry / branch / file / status edges plus `alias_of` / `about` joins onto canonical semantic terms
  - `lib/sessions.ts` promotes handoffs/findings/decisions/results/failures into episodic memory
  - `lib/sorties.ts` promotes blocked/completed/failed mission moments into episodic memory
  - `routes/tuples.ts` gained filtered tuple scanning so the new Memory view can search live tuple state
- semantic nomenclature harmonization is now explicit in code:
  - `lib/semantic-terms.ts` canonicalizes freeform labels into stable token sets, fingerprints them, and emits `semantic:alias` tuples plus `semantic_term --alias_of--> semantic_term` graph edges
  - `lib/semantic-resolver.ts` now adds the embedding-backed join layer on top using local Transformers.js inference with `Xenova/all-MiniLM-L6-v2`
  - embeddings are cached under `.cache/transformers/` after the first machine-local download, so semantic resolution is offline-cheap on subsequent runs
  - thresholds are no longer magic folklore:
    - auto-join threshold defaults to `0.88`
    - review threshold defaults to `0.80`
    - boundary monitoring margin defaults to `0.02`
  - operator visibility now exists through:
    - `GET /semantic/stats`
    - `GET /semantic/resolutions`
    - `GET /semantic/search`
    - Fleet Control Center `Memory` panel semantic cards / recent decision feed
  - near-threshold counts, review backlog, emitted `semantic:resolution` tuples, and persisted `semantic_resolution_events` are the current guardrails against silent threshold drift
- docs/skill drift also landed in this same working tree: `AGENTS.md` and `skills/port-daddy-agent-skill/SKILL.md` now explicitly require Port Daddy-first coordination on this computer
- validation truth on 2026-04-18:
  - broad `npm test` is green at `123/123` suites and `4689/4690` tests with `1` intentional skip
  - focused tuple/semantic suites (`semantic-terms`, `episodic-memory`, `merge-queue`, `fleet-engine`, `fleet-daemon`) are green
  - `npm run typecheck` is still red, but the remaining failures are the pre-existing `cli/commands/diagnostics.ts` `{}`-typing hole rather than regressions from this tuple/graph slice
- teardown / runtime hardening just validated cleanly in the working tree and should be cut next:
  - `lib/ipc-client.ts` now `unref()`s connect, reconnect, and request timeout timers so local IPC clients do not pin Jest workers
  - `lib/client.ts` now `unref()`s the SDK heartbeat interval for the same reason
  - `lib/webhooks.ts` now owns retry timers, supports `dispose()`, and fences off post-dispose writes/retries
  - `tests/unit/webhooks.test.js` now closes webhook/db state explicitly and covers retry cancellation on dispose
  - validation truth on 2026-04-11: `npm test -- --runInBand --detectOpenHandles` is green (`109/109` suites, `4523/4524` tests, `1` intentional skip) with no open-handle report
- newest validated runtime slice after that teardown work:
  - IPC router now exposes `sugar.whoami` and `fleet.prompt`
  - SDK one-shot request/response flows (`done`, `whoami`, `note`, `claimFiles`, `releaseFiles`) now use ephemeral IPC clients when talking to the canonical local daemon, then fall back cleanly for explicit TCP / alternate-socket targets
  - CLI `pd done`, `pd whoami`, and `pd note` now ride those SDK fast paths instead of duplicating raw HTTP behavior
  - `pd fleet prompt` now prefers IPC only for the canonical local daemon and otherwise stays on HTTP so alternate daemon targets do not drift
  - validation truth on 2026-04-11:
    - targeted router/client/CLI tests are green
    - `tests/integration/cli.test.js` is green
    - `npm test` passes `109/109` suites and `4529/4530` tests, but the old parallel Jest worker-force-exit warning still appears, so teardown debt is reduced but not fully closed
- newest committed operator-transport slice after that:
  - session SDK flows now cover `startSession`, explicit `endSession`, `sessions()`, and `removeSession()` through canonical-local IPC fast paths, while still falling back cleanly for explicit TCP / alternate-socket targets
  - CLI `pd session start/end/files/rm/sessions` now delegates to the SDK instead of hand-rolling raw HTTP around mismatched response contracts
  - operator-visible session parity bugs are fixed in the working tree:
    - conflict rendering uses `filePath` instead of the stale `file` key
    - `session done` reads `releasedFiles`
    - `session files rm` reads `released`
  - `pd with-lock` now routes through the SDK lock helpers instead of duplicating raw lock acquire/release fetch logic
  - validation truth on 2026-04-11:
    - targeted `client` / `ipc-router` / CLI tests are green
    - `npm test -- --detectOpenHandles --runInBand tests/unit/client.test.js tests/unit/ipc-router.test.js tests/integration/cli.test.js tests/unit/sugar.test.js tests/unit/sessions.test.js` is green with no open-handle report (`5/5` suites, `377` tests)
    - broad `npm test` is green at `111/111` suites and `4592/4593` tests, but the old parallel Jest worker-force-exit warning still appears, so that residual teardown debt is broader than this slice
  - discovered but not fixed in this slice: bare `--` is still not treated as end-of-options by `bin/port-daddy-cli.ts` even though the tutorial teaches `pd with-lock ... -- ...`; that parser file is currently claimed by another active session, so this follow-up is blocked on coordination rather than forgotten

Sequencing note for the active recovery thread:
- finish the remaining locks / tuples coordination tranche first
- the symbol-backed session/file-claim authority upgrade is now committed on `HEAD` at `df4c351`
- next polish after locks / tuples is to feed that committed symbol-backed truth consistently into graph edges, episodic memory, merge/conflict prediction, and the control plane instead of leaving any line-range-only holdouts

## New Product-Direction Intake (2026-04-10)

Captured from the docs-redesign/operator vision thread and now tracked as roadmap-grade work, not chat residue:

1. Human-in-the-loop is a first-class protocol, not a side path:
   - add explicit approval/pause/resume hooks inside long-running agent and sortie execution
   - expose HITL tool patterns in docs and product UI (operator can be requested mid-run, not only post-failure)
2. Queue-first fleet operation:
   - operators should enqueue work for fleets and walk away
   - Port Daddy should route queued jobs to the right agent/role based on roster + availability
3. Default background-agent throttle policy:
   - background agents should run in a conservative default cadence (for example, ~4 runs/hour) unless explicitly elevated
   - uplift windows should be explicit and time-bounded (for example 1-3 hour high-engagement windows)
4. FleetBar first-run and project onboarding:
   - from native shell, pick a local project, generate a recommended fleet roster, and launch tasks immediately
   - include an AI-assisted "design my fleet for this repo" path
5. DAG-native task decomposition in operator UX:
   - task entry should produce inspectable plan/DAG slices and let humans approve before dispatch
   - each agent/run must report structured state transitions (`pending`, `running`, `done`, `error`, `blocked`)
6. Session/agent lifecycle hooks:
   - ship explicit start/stop event handlers that publish into channels/tuples and can trigger downstream automation
   - treat these hooks as contract-level surfaces for integrations and observability
7. Docs IA/productization implications:
   - first-class docs pages for prompting, template quickstarts, and protocol/state
   - de-emphasize standalone template/blueprint marketing routes in favor of docs-native guided flows
   - add `llms.txt` + `llms-full.txt` to the docs website surface for LLM-readable navigation

## New Architecture Intake (2026-04-11)

Captured from the spawn-storm / remote-harbor thread plus `docs/plans/agentsd_ai_technical_architecture.md`: <!-- cite-exempt -->

1. Virtual-actor scheduling layer:
   - stop treating every watcher/subscriber as a peer that can wake every other participant
   - make `project`, `fleet`, `agent`, `harbor`, `sortie`, and trigger keys addressable virtual actors with single-mailbox semantics
   - keep tuples/pubsub/trie/graph as the shared medium, but gate activation through actor mailboxes so cooldown, dedupe, backoff, singleton, and budget policy live in one place
2. Spawn-discipline hardening:
   - first concrete step is per-agent cooldown, trigger dedupe, and exponential backoff in the fleet engine
   - next step is actor-native queueing / escalation so repeated triggers can collapse to cheap local review, defer, or upgrade instead of always spawning
3. Cloudflare support roadmap:
   - immediate runtime slice: first-class Cloudflare Workers AI backend support in spawn/fleet surfaces
   - next infra slice: AI Gateway for spend/control-plane policy, Vectorize + AI Search for shared retrieval surfaces, and a deliberate evaluation of AutoRAG where it actually reduces glue code
4. Remote harbor / lighthouse groundwork:
   - centralized human auth dispenser and daemon attestation remain the long-pole trust surface
   - remote harbor design should assume key issuance, registry, Merkleized evidence exchange, and revocation-friendly filters (cuckoo/bloom/Merkle proof path), not just "ship messages over the network"

### Actor-Model Reconciliation (2026-04-23)

Architecture decision now captured in `docs/adr/0022-durable-actor-souls-and-body-leases.md`.

The core conclusion: do not "fix" agent history loss by simply stopping row deletion. The current runtime uses agent-row deletion as part of orphan detection, lock cleanup, IPC authorization, Arbiter checks, and salvage visibility. The correct migration is a durable actor soul plus an ephemeral body lease:

- actor soul: stable identity, mailbox, archetype, belief state, history, and operator-visible addressability
- body lease: heartbeat, PID/process or transport attachment, incarnation/generation, and authority to perform protected actions
- salvage: adoption or recovery of a dead/revoked body lease attached to a durable soul, not resurrection of a deleted identity
- inbox: actor-scoped mailbox; wake status is a separate live-runtime concern
- auth: protected IPC/HTTP actions require a live lease or delegated token, not mere actor existence

Implementation roadmap additions:

1. Add `/actors`, `/actors/:id`, and `/actors/:id/message` as additive durable-soul surfaces while `/agents` remains the live-body compatibility view.
2. Add explicit lease/incarnation state before changing cleanup semantics:
   - `attached`, `draining`, `detached`, `dead`, `revoked`
   - heartbeat timestamp, PID/process/transport metadata, optional local lease token
3. Change `pd done`, spawner cleanup, and stale-agent cleanup to detach/revoke body leases instead of deleting durable identities.
4. Replace `sessions.abandonOrphanedActive()` missing-row logic with dead/revoked-lease detection.
5. Move lock/file/session/merge authority checks to live leases while preserving durable soul attribution for audit and handoff.
6. Reframe salvage queue entries as lease recovery/adoption state on an actor soul.
7. Update Fleet Control Center and FleetBar:
   - actor directory is durable identity truth
   - live registry becomes deployment/lease state
   - salvage ghosts become actor recovery states
   - direct messages can queue for dormant actors and separately report wake success/failure
8. Update SDK/OpenAPI/site docs and tests that still say "done unregisters the agent" or "only registered agents have inboxes."
9. Treat configured fleet agents, projects, harbors, sorties, and trigger keys as mailbox-owning actors so cooldown, dedupe, backoff, singleton, and budget policy have one home instead of being spread across watchers and subscribers.

Unintended consequences to guard against:

- stale processes must not retain lock/session/salvage authority just because their soul persists
- random `spawned-*` jobs must not pollute the durable actor directory without an archive/retention policy
- UI counts must not inflate by treating every historic lease as a live agent
- compatibility fields like `agentUnregistered` need a deprecation window, not a silent shape break
- inbox persistence needs quota and retention policy once dormant actors become addressable

## Latest Landed Slice (2026-04-11)

The current-session drift investigation now has a concrete working-tree fix:

- local CLI context is no longer modeled as one mutable repo-global `.portdaddy/current.json`
- `pd begin` now writes slot-scoped context files under `.portdaddy/contexts/<slot>.json`, while `current.json` is retained only as a compatibility pointer
- slot reads are fail-closed: a shell/agent no longer falls through into some other slot's latest context just because `current.json` was written last
- `sessions.quickNote()` now accepts explicit `sessionId`, respects explicit session targeting, and fails closed on ambiguous unscoped worktree state instead of drifting to global "most recent active"
- direct-mode `pd note` now forwards slot context (`sessionId`/`agentId`) instead of relying on unscoped quick-note fallback
- regression coverage now exists for slot isolation plus ambiguous quick-note rejection

## Latest Validated Working-Tree Slice (2026-04-11)

Tunnel cost-safety hardening is now real in the working tree:

- `lib/tunnel.ts` now treats tunnels as budgeted managed resources instead of loose child processes:
  - default max-active tunnel cap
  - default tunnel TTL / expiry
  - persisted tunnel metadata for restart reconciliation
  - periodic cleanup plus synchronous stale-state sweeps
  - safe orphan cleanup only when the persisted PID still matches the expected provider/port command line
- `server.ts` now stops all managed tunnels during graceful daemon shutdown and disposes the tunnel reaper, so shutdown does not leave Port Daddy-managed tunnels behind
- `routes/tunnel.ts`, `cli/commands/tunnel.ts`, and `lib/client.ts` now surface expiry metadata / cleanup reasons so operator output does not hide the safety policy
- regression coverage now exists in `tests/unit/tunnel.test.js` and `tests/unit/tunnel-lifecycle.test.js` for:
  - tunnel budget exhaustion
  - TTL reaping
  - stale DB-record cleanup
  - orphan-process cleanup
- validation truth on 2026-04-11:
  - focused `npm test -- tunnel-lifecycle tunnel.test` is green
  - broad `npm test` is green at `114/114` suites and `4627/4628` passing tests with `1` intentional skip
  - `npm run typecheck` is still red, but the failures are the same broader pre-existing CLI/client/IPC typing debt family; this slice only added and fixed its own new tunnel CLI typing edges

## Active Tasks

This is the normalized remaining-slice inventory as of 2026-04-24. It supersedes the older duplicate-numbered queue below this point in git history, but the detailed evidence remains in the surrounding sections.

### A. Cut, Commit, Promote, And Keep Runtime Truth Aligned

1. Split the dirty working tree into coherent promotable slices instead of one mega-commit:
   - maritime actor foundation (`/actors`, `pd actor(s)`, manifest/OpenAPI/completions/skill docs, tests)
   - event-driven Tree-sitter symbol refresh
   - tuple/graph/memory/semantic harmonization
   - spawn-discipline and Cloudflare backend work
   - FleetBar/control-plane project truth and operator UX work
   - public website/docs/distribution changes
2. For every runtime-serving slice, run focused tests, `npm run typecheck`, `npm test`, `npm run build`, then promote with `./scripts/promote-stable.sh` before claiming live operator truth.
3. Keep `/Users/erichowens/port-daddy-stable` clean and non-dogfood-only; no `.spark/`, `.spider/`, daemon DBs/logs, fleet output, or build garbage should accumulate there.
4. Continue using Port Daddy notes, file claims, tuples, and briefing/salvage for every recovery step so future sessions can reconstruct work without chat archaeology.
5. Keep release surfaces synchronized in the same slice: README/help, `AGENTS.md`, skills, OpenAPI, MCP parity, completions, website docs, and FleetBar/native affordances.

### B. Navigator And Cartographer

1. Finish the Navigator/Cartographer bootstrap pass as a report-first reconciliation:
   - inventory authority surfaces
   - classify docs as authoritative, active-ledger, release-surface, historical, quarantined-research, generated-artifact, stale, or conflicting
   - extract roadmap items, work slices, blockers, dependencies, evidence, stale claims, and supersession edges
   - emit `roadmap:item`, `work:slice`, `doc:authority`, `evidence:*`, `blocker`, `depends_on`, and `supersedes` tuples before prose rewrites
2. Add the durable read model behind the human `.cartographer/status.md` projection:
   - actors/sessions/claims/files/symbols/commits/tests/promotions graph joins
   - work-slice status and evidence links
   - stale/conflicting document report
   - periodic refresh with cooldown/dedupe/backoff
3. Decide the first persisted shape: SQLite tables now versus `.cartographer/bootstrap-report.json` plus tuples first.
4. Decide patch authority: which docs Navigator may update automatically, which require human approval, and which must only receive proposed cleanup patches.
5. Coordinate ownership with Harbormaster: promotion truth probably belongs to Harbormaster, with Navigator projecting it into the recovery map.

### C. Durable Actor Souls And Body Leases

1. Move beyond the current static `/actors` projection:
   - `POST /actors/:id/message` now queues durable actor mailbox messages; `GET /actors/:id/inbox` and `GET /actors/:id/inbox/stats` expose mailbox read/depth
   - next work is body-lease wake policy and richer lease/incarnation state
   - expose recent sessions, recent salvage state, last activation, and live lease state in control-plane actor views
   - SDK/client helpers for actor directory, messaging, and inbox reads now exist
2. Add explicit body lease/incarnation state before changing cleanup semantics:
   - status: `attached`, `draining`, `detached`, `dead`, `revoked`
   - heartbeat and PID/process/transport metadata
   - incarnation/generation number
   - optional local lease token for protected actions
3. Change normal completion so `pd done`, spawner cleanup, and stale cleanup detach/revoke body leases instead of deleting durable souls.
4. Replace missing agent row orphan logic with dead/revoked lease detection.
5. Move protected operations to lease-aware authority:
   - IPC auth
   - lock/file/session mutation
   - merge submission
   - salvage adoption
   - Arbiter checks
6. Keep `/agents` as the live-body compatibility view while Fleet Control Center and FleetBar migrate toward actor-directory truth.
7. Add tests that prove actor souls survive `done`, inbox survives detachment, stale leases cannot perform protected actions, and stale cleanup releases only lease-owned resources.

### D. Coxswain: Claims, Locks, Stale Assets, And Symbolic Coordination

1. Make file path locks work directly or make the required semantic syntax unambiguous in CLI/help/tests.
2. Make `who-owns` lease-aware:
   - last claimed by whom and when
   - current lease/body status
   - last edit/mutation evidence
   - attempted claims/edits
   - stale/zombie classification and reclaim affordance
3. Add stale asset salvage, not just stale session salvage:
   - zombie `session_file` claims must not cripple coordination files
   - reclaim should be explicit, audited, and evidence-backed
4. Finish Tree-sitter-backed claim authority:
   - use canonical `symbolPath` where symbol data exists
   - keep line ranges only as fallback/display
   - index non-code coordination documents by section anchors if they are claim hotspots
   - expose first-class CLI/MCP symbol discovery and claim-refinement affordances, not only region-claim pass-through
   - make symbol freshness automatic in the promoted daemon; the event-driven refresh design exists in recovery notes/stash residue but is not current committed runtime truth
5. Wire claims into graph/memory:
   - `session --claims--> file`
   - `session --claims_symbol--> symbol`
   - `actor/session --attempted_claim--> resource`
   - `session --mutated--> file/symbol`
6. Feed symbolic-claim truth into merge/conflict prediction and control-plane visualization instead of resting on lossy line spans.
7. Build on the new Compass advisor slice:
   - surface `pd advise` / `coordination_preflight` in FleetBar and Fleet Control Center
   - add stale asset reclaim actions with lease/body evidence
   - project file claims and attempted claims into graph edges
   - teach the advisor section-anchor claims for hot coordination docs
   - keep recommendations deterministic, evidence-backed, and executable
8. Add claim-preserving destructive-git guardrails:
   - `git add -A`, `git reset --hard`, and cherry-pick should not
     steamroll active claims
   - provide a safe `pd add` / stage wrapper that excludes claimed paths
   - surface bulldozed claims as a coordination callout instead of a
     silent revert

### E. Sounder: Tuple, Graph, Memory, And Semantic Collapse

1. Decide whether the graph + episodic-memory slice is the next real cut or quarantine; do not leave it half-landed.
2. Finish tuple-first coordination:
   - `trigger_tuple` fleet inputs
   - fleet lifecycle as `fleet:event`
   - merge lifecycle as `merge:event`
   - memory episodes as `memory:episode`
   - tuple-triggered fleet agents and IPC tuple fast path if still missing after review
3. Finish graph/memory runtime surfaces:
   - `graph_edges`
   - `episodic_memory`
   - symbol/file/dependency edges
   - session/sortie/merge/claim memory promotion
   - Fleet Control Center Memory panel
4. Keep synonymy collapse disciplined:
   - deterministic lexical canonicalization first
   - embedding-backed near-neighbor suggestions second
   - review queue for boundary cases
   - no arbitrary “sounds good” threshold without calibration, examples, and operator-visible review statistics
5. Add evaluation fixtures for synonym classes that matter to this repo: website/docs/design-system terms, actor/agent/body terms, fleet/project/runtime terms, claim/lock/mutation terms, harbor/lighthouse/remote terms.
6. Decide whether WordNet is useful only as a weak lexical feature. It should not be the sole authority for repo-specific semantic collapse.

### F. Signalman, Breaker, And Caulker: Validation, Robustness, Failure Propagation

1. Keep adding regression tests for every newly discovered bug that existing tests missed.
2. Preserve the full-suite discipline: focused tests for iteration, full `npm test` before broad health claims.
3. Treat any future `A worker process has failed to exit gracefully` warning as real teardown debt even if exit code is green.
4. Use the Nygard resilience skill for failure propagation, circuit breakers, bulkheads, timeouts, retry storms, and cascading failure work.
5. Build failure-propagation observability:
   - failed spawn chains
   - IPC disconnect cascade cleanup
   - tunnel/provider failures
   - retry/backoff state
   - open circuit state
6. Add forensic context windows to Arbiter violations so failures include nearby session, tuple, graph, mutation, and process evidence.
7. Finish any remaining CLI command help hazards such as `pd done --help` performing the command.
8. Keep WAL health visible: WAL is already enabled in `lib/db.ts`, but diagnostics/doctor should prove journal mode, busy timeout, checkpoint behavior, and DB path truth against the live daemon.

### G. Quartermaster: Spawn Discipline, Costs, Backend Policy, And Fleet Activation

1. Finish default fleet spawn controls:
   - per-agent cooldown
   - trigger dedupe
   - exponential backoff
   - singleton enforcement
   - project-level caps
   - spawn-per-hour caps
2. Expose those controls in operator surfaces, not only in logs.
3. Implement actor-style mailboxes so repeated triggers collapse to one queued activation instead of many independent spawns.
4. Make manual upkeep runs possible even under active-agent pressure; `pd fleet run documentarian` and `pd fleet run cartographer` should not starve behind the always-on fleet.
5. Separate cheap local upkeep from hosted model escalation:
   - broad low-signal sweeps default to Ollama/local
   - operator-triggered high-signal work may request Codex/Claude with an explicit budget
6. Keep Codex backend spend-aware:
   - low: `gpt-5.4-mini`
   - mid: `gpt-5.3-codex`
   - high: `gpt-5.4`
7. Keep all-backend tier truth consistent across daemon, CLI, SDK, MCP, fleet model catalog, readiness, and UI.
8. Keep telemetry fail-closed: no operator launch is acceptable without exact token counts, exact nonzero model rate, and persisted exact nonzero cost unless there is explicit HITL bypass metadata.
9. Surface fleet launchability truth in `pd status` / FleetBar:
   - show skipped registrations, launchability blockers, and wallet
     gates before the operator has to inspect raw JSON
   - keep cartographer cadence visible so a "healthy" fleet cannot hide
     the reason nothing actually ran
10. Surface telos-driven model suggestions at spawn time:
   - derive the hint from durable telos, the live backend resolver, and
     the fleet model catalog
   - keep the suggestion explicit and overridable; never hide the
     actual backend the operator selected
   - surface the hint in `pd spawn`, FleetBar, and Fleet Control Center

### H. Harbormaster: Promotion, Distribution, Daemon Freshness, And Runtime Truth

1. Continue treating promotion as normal runtime hygiene, not a rare ceremony.
2. Verify live truth after every runtime slice:
   - socket path
   - TCP/browser path
   - FleetBar embedded bundle
   - live daemon install root
   - CLI shim path
3. Finish daemon discovery/loopback cleanup:
   - no new hardcoded `localhost:9876`
   - docs/templates/operator labels cleaned up
   - diagnostics/startup doctor wording honest about preferred versus actual daemon port
4. Finish fleet lease recoverability verification: `lock not held` plus no holder should reacquire instead of leaving a project skipped.
5. Kill or replace leaked legacy watchers that still publish naked `git:committed`.
6. Make project-scoped hook replacement complete in `pd init` / `pd fleet init`.
7. Finish distribution slices:
   - packaging docs and package assets
   - release workflow
   - macOS pkg signing/notarization path
   - FleetBar cask/pkg parity
   - landing-page download truth
8. Keep promotion-time release-surface review healthy:
   - `promote-stable.sh` must emit `promotion:release-surfaces` after tests pass and before stable merge
   - the event must remain tuple + pub/sub, not an unconditional direct AI spawn
   - Documentarian/Lookout must keep singleton/cooldown/dedupe/backoff so repeated promotion attempts collapse instead of burning fleet budget
   - use `PORT_DADDY_PROMOTION_REVIEW_REQUIRED=1` when stale docs should block promotion, and `PORT_DADDY_PROMOTION_REVIEW_ONLY=1` when agents need a pre-merge docs pass
9. Finish Bosun/Barnacle consolidation:
   - V2 `bin/watchdog.ts` / `daemon:watch` are removed in the active Bosun slice <!-- cite-exempt -->
   - daemon heartbeat writer and `core/pd-bosun/` std-only supervisor scaffold are in-tree
   - remaining: distribute `dist/core/pd-bosun`, promote `com.portdaddy.bosun`, then remove legacy Barnacle crate/client/compat field after the compatibility window

### I. Lookout: Docs, Skills, OpenAPI, Website, And Product Truth

1. Keep the Port Daddy-first cooperation instruction synchronized across `AGENTS.md`, skills, README/docs, and generated release surfaces.
2. Finish docs around slot-scoped `.portdaddy/contexts/<slot>.json`; stop describing `current.json` as the only current-context truth.
3. Keep `pd fleet validate`, `pd actor(s)`, Cloudflare backend support, actor/body terminology, and backend tier ladders reflected in skill/API/docs surfaces.
4. Keep public-site work honest:
   - active site is a hybrid preservation pass, not an `agentsd.ai` replacement
   - `docs/AGENTSD_*` remains quarantined research unless explicitly promoted
   - no route jungle regression
   - no public runtime overclaims
5. Finish website docs IA only where it supports operator truth:
   - docs registry
   - get started
   - examples
   - best practices
   - concepts
   - reference
   - LLM exports
6. Add Lookout drift checks for parity between routes, manifest, OpenAPI, CLI, completions, MCP, website docs, and skill reference.
7. Keep Lookout/Documentarian focused on promotion-time release surfaces, not every commit:
   - README, CHANGELOG, feature manifest, OpenAPI, SDK docs, CLI help/completions, website docs/tutorials, MCP instructions, and the distributed Port Daddy skill
   - scope reviews to the promotion payload's source SHA and changed files
   - report `CLEAN` with evidence instead of making cosmetic docs churn
8. Translate the Google Agents CLI research into a lifecycle-first Port Daddy docs/CLI proposal:
   - `setup`
   - `scaffold create`
   - `scaffold enhance`
   - `scaffold upgrade`
   - `run`
   - `eval`
   - `deploy` / `promote`
   - `publish`
   - `observe`
   - agent-engineering skill bundles as a release surface, not loose prose

### J. FleetBar And Fleet Control Center

1. Verify the live native shell after promotion, not only screenshots or dev bundles.
2. Keep FleetBar opening the real control plane, with no duplicate embedded chrome.
3. Add a native project switcher and avoid auto-stranding the operator on the first project.
4. Preserve the selected surface across project changes.
5. Make Activity, Channels, Inbox, Sorties, Memory, and YAML real full-width top-level pages.
6. Fix Activity truth:
   - structured project activity
   - per-agent last-active
   - non-empty messages
   - recent mutations
   - touched files and artifacts
7. Add an explicit ad hoc jobs lens for `pd agent` and raw `pd spawn` runs that exist in spawned/session history but not the live fleet registry.
8. Remove inspector/focus confusion:
   - Activity focuses agents in-page
   - global slide-in inspector stays a Flow tool
   - no persistent detail drawer across unrelated tabs
9. Keep file actions truthful:
   - resolve relative paths against the correct project/workdir
   - expose Finder/default-editor actions
   - never degrade known context to bare `Not Found`
10. Make FleetBar popover show recent per-agent summaries, touched files, salvage hints, suspicious stale-active sessions, resume-worthy history, and recent non-trivial notes.
11. Add obvious project onboarding:
   - `pd init`
   - `pd fleet init`
   - `pd fleet up`
   - `pd mcp install`
   - curated starter fleets
   - “design my fleet with AI” only after budget/readiness gates are clear
12. Fix native-shell ergonomics:
   - singleton Fleet Control Center window
   - sane Dock activation behavior
   - obvious start/stop/pause/enable controls
   - per-agent run/pause/stop controls
   - deployable fleet subsets
   - resizable split panes where density demands it

### K. Sorties, HITL, DAG UX, And Delegation Modes

1. Verify sortie launch end-to-end against the live daemon and installed CLI.
2. Preserve chosen backend/model/budget after launch attempts.
3. Surface daemon `/spawn` or preflight errors inline with exact error text.
4. Root-cause the Claude SDK readiness/reset path where UI said ready, attempted launch, then reverted to `claude-cli`.
5. Define sortie recipes like `investigate`, `fix`, `review`, and `creative` in product docs and UI, not only cards.
6. Make sortie roster selection real and editable against explicit agent definitions.
7. Add sortie status and results pages:
   - steps
   - artifacts
   - messages
   - mutations
   - budget state
   - drill-in outcomes
8. Add explicit human-in-the-loop controls for approval, pause, resume, intervention, and result acceptance.
9. Build DAG-native task decomposition in operator UX with inspectable slices and human approval before dispatch.
10. Keep the `pd agent` registry, `pd spawn` launches, fleet agents, and harbor missions distinct in product language and history surfaces.

### L. Cloudflare, Remote Harbor, Lighthouse, And Distributed Trust

1. Finish Cloudflare Workers AI as a real backend family:
   - runtime execution
   - readiness
   - model catalog
   - spawn/fleet CLI
   - SDK/MCP/OpenAPI/docs
   - exact telemetry and cost attribution
2. Add AI Gateway planning and eventual implementation for centralized policy, observability, caching, request retry, model fallback, and provider routing.
3. Evaluate Vectorize and AI Search for shared retrieval:
   - remote harbor memory
   - documentation search
   - graph/tuple-backed retrieval
   - controlled RAG pipelines
4. Evaluate AutoRAG/AI Search as managed infrastructure only where it reduces glue code without replacing Port Daddy’s graph/tuple-native memory authority.
5. Plan remote harbor/lighthouse as a trust and registry system:
   - centralized user auth dispenser
   - daemon attestation
   - local keychain-backed signing keys
   - registry for lighthouses and capabilities
   - Merkleized evidence exchange
   - revocation filters and definitive proofs
   - capability attenuation for child agents
6. Keep Cloudflare research current against official docs before implementation because Workers AI, AI Gateway, Vectorize, and AI Search are moving targets.
7. Treat Cloudflare tunnels as cost/safety-managed resources, not free background processes.

### M. Archaeology, Ideas, And Roadmap Curation

1. Curate stable-only Spark/Spider residue through `docs/recovery/IDEAS-TROVE.md`, not by promoting raw generated markdown.
2. Elevate only surviving ideas that still matter:
   - capability-aware DNS/harbor discovery
   - persistent fleet run journal / `pd fleet history`
   - forensic context windows on Arbiter violations
   - IPC disconnect to immediate salvage/cascade cleanup
   - tuple-triggered fleet agents
   - IPC tuple fast path
   - merge queue event bus bridge
   - symbol-aware spawn preflight and hot-zone signals
3. Keep `.spark/`, `.spider/connections/`, and `.dogfood/` ignored local residue unless explicitly curated into real docs/features.
4. Reject redundant bug batteries that freeze known-bad behavior; fold durable assertions into canonical tests.

### Skills And Research Needed

1. No brand-new skill is strictly blocking the next implementation cut. Existing local skills cover the biggest upcoming domains:
   - `nygard-2018-release-it-2nd-edition` for Breaker/Caulker resilience and circuit-breaker work
   - `agha-actor-model` for actor mailbox/lease/runtime modeling
   - `cloudflare-worker-dev` and `cloudflare-pages-cicd` for Cloudflare runtime and deploy surfaces
   - `agentic-zero-trust-security`, FIPA agent-management skills, and `proverif-tamarin-protocol-modeling` for remote harbor identity/capability/revocation design
   - `event-driven-architecture-expert`, `runtime-verification-for-agents`, `observability-apm-expert`, and `cost-verification-auditor` for Signalman/Breaker/Quartermaster work
2. Skill additions that would help but are not mandatory:
   - a first-party `cloudflare-ai-platform` skill focused specifically on Workers AI, AI Gateway, Vectorize, AI Search, pricing/limits, and telemetry integration
   - a first-party `port-daddy-actor-runtime` skill encoding ADR-0022/0023, maritime actor names, lease invariants, and migration traps
   - a first-party `symbolic-coordination` skill for Tree-sitter claims, symbolPath identity, graph edges, and merge-conflict prediction
   - a first-party `cartographer-bootstrap` skill for document authority classification, tuple vocabulary, and recovery ledger cleanup policy
   - a first-party `port-daddy-agent-lifecycle` skill inspired by Google's `agents-cli` skill split, covering setup/scaffold/enhance/upgrade/eval/deploy/publish/observe for Codex, Claude, Gemini, and other skill-aware agents
3. Research required before the relevant slices:
   - official Cloudflare docs refresh for Workers AI, AI Gateway, Vectorize, AI Search, model catalog, auth scopes, pricing/limits, and OpenAI-compatible endpoint behavior
   - actor runtime literature/practice review using Agha plus FIPA AMS/DF separation before schema-locking actor souls and body leases
   - semantic collapse evaluation design before changing thresholds: labeled examples, false-merge/false-split metrics, review queues, and repo-specific vocabulary
   - remote harbor threat model before lighthouse implementation: key custody, attestation, delegated tokens, Merkle receipts, revocation filters, and replay resistance
   - resilience pattern pass using the Nygard skill before adding circuit breakers/backpressure across spawn, tunnel, Cloudflare, IPC, and webhook integration points
   - deeper implementation read of `google/agents-cli` templates, skill files, eval result formats, and upgrade/merge behavior before copying any lifecycle surface

## Plan-backlog ingestion 2026-05-22 (Cartographer follow-up to PR #166)

Gap-fill pass over four long-form `docs/plans/` files that the 2026-05-21
hanging-chad sweep (PR #166) did not enumerate. Each item below is a
still-open deliverable from one of those plans that is NOT already
covered by PR #166's `Session backlog 2026-05-21` section. Source plan
file is cross-referenced on each cluster. Priority stamps match PR #166's
convention: HIGH / MEDIUM / LOW / BLOCKED.

### Cluster TUBE — Coordination substrate roadmap

Source: `docs/plans/TUBE-AS-COORDINATION-SUBSTRATE-ROADMAP.md` (updated 2026-05-02). <!-- cite-exempt -->

**Phase 0 prerequisites / blockers (Spider 2026-05-02 harvest):**

- [ ] **Activity-attribution `target_id` nullability fix** — HIGH — trove ticket `activity-target-id-nullability-fix` (status `now`). Sugar/session/sortie writers stamp `target_id = null` for many rows; roadmap claim "audit trail is automatic, replay is free" is false on this path. **Gates TUBE Phase 3.** Note line 1399 acknowledges the bug at source level but the TUBE-gating dependency is not tracked anywhere else.
- [ ] **Harbor-token capability enforcement** — HIGH — `harbor-tokens.ts` JWTs encode `capabilities[]` but no route or IPC handler reads the array. Spider rediscovered this five times across runs (`2026-03-31-v2`, `2026-04-05-eighth`, `2026-04-07-seventeenth`, `2026-04-07-eighteenth`, `2026-03-31-third-run`). **Gates TUBE Phase 4.** Either ship capability binding with `tube-acl-v1.md` or explicitly declare "all participants on a channel are mutually trusted."
- [ ] **Channel scoping engine vs archaeology** — MEDIUM — stale watchers in foreign worktrees wake on logical-not-physical channel keys. **Gates TUBE Phase 6** (cross-project leakage breaks the connector substrate).
- [ ] **Blob store is Phase 0 mandatory** — HIGH — `lib/blob.ts` + `routes/blob.ts`, content-addressed at `~/.port-daddy/blobs/<sha>`, `POST /blob` multipart returning `{id, sha256, size}`, `GET /blob/:id`. ~80 LOC. Spider 2026-05-02 reversed the V1-punt decision. Codex CLI branch `codex/main-ci-blob-gc-boundary` may have started this — verify before duplicating. Unblocks every artifact-bearing tube use case and Spark `shipping receipts` / `autodraft release notes` items.

**Phase 0 deliverables (this week per the plan):**

- [ ] **`docs/coordination/primitives.md`** — MEDIUM — codify the pub/sub vs inbox vs tuples vs tube distinction matrix as durable docs. Replaces ad-hoc explanations in tutorials. <!-- cite-exempt -->
- [ ] **`docs/tutorials/pd-tube-as-ui-button.md`** — LOW — second tube tutorial showing channel-as-UI-button pattern (post-from-curl, react-from-listener). <!-- cite-exempt -->
- [ ] **Three-horizon briefings absorption** — LOW — `pd briefing` consumes `tuples.scan()` to surface the live-tuple horizon alongside the activity-log horizon. Absorbs Spark item `spider-2026-04-07-three-horizon-briefing.md`.

**Phases 1+ (post-foundation):**

- [ ] **Phase 1 Scout Chrome extension** — MEDIUM — `apps/pd-scout-extension/`, Manifest V3, `Cmd+Shift+K` project picker, capture modes (Page/Selection/Region), Readability.js extract, `chrome.tabs.captureVisibleTab`, POST to `<project>:scout:inbox`, reference triage agent `fleet/triage.sh`. ~1 week scope. <!-- cite-exempt -->
- [ ] **Phase 2 Stevedore V1 (feedback extension)** — MEDIUM — `apps/pd-feedback-extension/`, localhost-only enforcement at three layers, drag-rect overlay, 3-second decompose pipeline, React fiber bones overlay, repro recorder emitting `repro.spec.ts`. ~2 weeks scope. Depends on blob store.
- [ ] **Phase 3 tube-as-UI rewire** — MEDIUM — migrate destructive dashboard and FleetBar actions (claim/release/lock/spawn/abort) from RPC to tube performatives on `<project>:ui:requests`. Reads stay RPC. ~1 week, parallelizable. Blocked on activity-attribution fix above.
- [ ] **Phase 4 A2A protocol layer** — MEDIUM — extend envelope with `pd tube --act <performative> --protocol <name>` (FIPA-00037 performatives, FIPA-00025 protocol templates). Ship `pd auction <channel>` as first-class CFP/bid/award helper. `coordination-judge.ts` learns thread-shape templates. ~2 weeks. Blocked on harbor capability enforcement above.
- [ ] **Publish `tube-acl-v1.md` spec** — LOW — durable wire-format doc for Phase 4. Pairs with Phase 8.
- [ ] **Phase 5 Stevedore V2** — LOW — Vue/Svelte source-map adapters, generic source-map fallback, DevTools panel, CDP screenshot, Playwright `trace.zip`, voice memo + Whisper, redaction rule editor. ~3 weeks.
- [ ] **Phase 6 external connector zoo** — LOW — Slack `/pd` slash, iMessage/SMS (existing Track B1), Linear webhook, `git post-commit`, Sentry, calendar, cron/launchd, FleetBar context menu. ~50 LOC of glue each. Note: GitHub webhook connector overlaps PR #166's "GitHub App webhook receiver" chad.
- [ ] **Phase 7 Thread-as-Argument-Graph viewer** — LOW — render any tube thread as a Toulmin/Lakatos tree in the dashboard; `coordination-judge.ts` scores subtree quality. The wow feature only tube can produce. ~3 weeks.
- [ ] **Phase 8 Open Spec publication** — LOW — publish `tube-acl-v1.md` externally; long bet on vendor-neutral A2A substrate.

### Cluster PHONE — Phone-integration master plan

Source: `docs/plans/PHONE-INTEGRATION-MASTER-PLAN.md` (updated 2026-04-26). Tracks A1, B1, B2 are shipped; remaining tracks are open.

- [ ] **B3 button-click HTML demo** — LOW — `examples/button-click-demo/` (HTML + README); recorded GIF deferred to GIF-CI work. ~half-day; depends on B1 (shipped).
- [ ] **C1 ADR-0026 Relay Architecture** — MEDIUM — use `templates/ADR-Relay-Architecture.md`; lands as `docs/adr/0026-relay-architecture.md`. Gates C2. <!-- cite-exempt -->
- [ ] **C2 Relay v0 implementation** — MEDIUM — `lib/relay-envelope.ts` (pure-fn wire format), Cloudflare Worker + Durable Object scaffolding, identity registry per ADR-0025 OIDC choice, `lib/relay-client.ts` outbound-only daemon SSE client. ~3-4 weeks initial scope. Blocked on C1. <!-- cite-exempt -->
- [ ] **D1 VS Code extension `port-daddy-vscode`** — MEDIUM — selection-based publish, right-click "Ask Claude about this", diagnostic-reactive publish, subscribe to `editor:reply:<id>` for inline rendering. ~1 week; separate repo. Depends on B1 (shipped).
- [ ] **D2 Test runner publishers** — LOW — `@port-daddy/jest-reporter` and `port-daddy-pytest`; both publish on first failure to `test:failed`. ~3-4 days each; parallelizable. Depends on B1 (shipped).
- [ ] **E1 Phase 3 attenuation in production code** — LOW — promote `scripts/attenuate_card.py` algorithm to `lib/`; OIDC exchange endpoint on relay; GH Actions integration walkthrough lifts `examples/attenuation-walkthrough.md`. Depends on Tracks B + C. <!-- cite-exempt -->
- [ ] **E2 ProVerif extension** — LOW — copy `templates/proverif-relay.pv` into `analyses/relay-handshake.pv`, fill in queries from `references/proverif-relay-extension.md`, iterate until I1 + authentication pass. Depends on Tracks B + C. <!-- cite-exempt -->
- [ ] **E3 ADR-0027 V4 Remote Harbor Redefinition** — LOW — use `templates/ADR-V4-Remote-Harbor-Redefinition.md`; update `V4-DAG.md`, `v4.dag.yaml`, `V4-MASTER-PLAN.md`, `README.md`; implement `pd harbor share` / `pd harbor join`. Depends on Tracks B + C.
- [ ] **ACME on self-hosted `step-ca` (PKI v1)** — LOW — ADR-0025 phased plan; v1 follows the shipped v0 OIDC. No dispatch yet.
- [ ] **Self-hosted OIDC issuers + BYO-domain ACME (PKI v2)** — LOW — ADR-0025 v2 phase; far future.

### Cluster ANCHOR — Anchor protocol workstream backlog (AP-001..AP-022)

Source: `docs/plans/anchor-protocol-workstream-backlog.md` (updated 2026-04-11). PR #166 captures the Task #100 ("Anchor paper Bonded-style upgrade") umbrella but does not enumerate the 22 AP-tagged sub-tasks. The plan's own "Immediate Next Slice" recommendation is AP-001 / AP-002 / AP-003 / AP-010 / AP-016 / AP-018. <!-- cite-exempt -->

**Cluster A — Protocol truth (whitepaper honesty):**

- [ ] **AP-001 Rewrite Anchor whitepaper limitations around semantic gap** — MEDIUM — replace current limitations framing with explicit "formal models reason about logical identities, real swarms run as ephemeral OS processes." Files: `docs/reports/PORT_DADDY_ANCHOR_WHITEPAPER.md`, `website-v2/public/whitepaper/anchor-protocol-whitepaper.tex`. Recommended in plan's "Immediate Next Slice."
- [ ] **AP-002 Expand verification-stack explanation (ProVerif / Kani / TLA+)** — MEDIUM — present verification as a layered stack; mention TLA+ only if real artifacts exist. Recommended in "Immediate Next Slice."
- [ ] **AP-003 Close ProVerif-to-Kani proof gap explicitly** — MEDIUM — one bridging sentence near subset-logic discussion. Recommended in "Immediate Next Slice."
- [ ] **AP-004 Align phase numbering / algorithm numbering / protocol evolution language** — LOW — renumber to remove cross-map effort for readers.
- [ ] **AP-005 Add control-plane architecture paragraph to introduction** — LOW — reframe paper as systems architecture.

**Cluster B — Daemon hardening roadmap:**

- [ ] **AP-006 Daemon-hardening sub-roadmap (OS/process binding)** — MEDIUM — PID/process identity binding, socket ownership, race windows around crashed agents reclaiming ports, Linux-first vs macOS parity. Likely lands as new ADR.
- [ ] **AP-007 Define root-key custody modes** — LOW — local software / Secure Enclave-TPM / cloud KMS-HSM mode table; threat + packaging implications.
- [ ] **AP-008 Specify revocation architecture honestly** — LOW — in-memory revoked-jti set vs persisted revocation log vs probabilistic structures; first impl path must be simple/debuggable, no Bloom-filter cargo culting.
- [ ] **AP-009 Clarify local vs remote transport defaults** — LOW — local IPC/UDS vs networked harbor-to-harbor are different transport problems.

**Cluster C — Economy and monetization:**

- [ ] **AP-010 Separate protocol / economy / monetization in roadmap** — MEDIUM — explicit section boundaries in `V4-UNIFIED-ROADMAP.md` and ADR-0014. Recommended in "Immediate Next Slice"; plan calls this "the single biggest conceptual cleanup."
- [ ] **AP-011 Build honest readiness ladder for the economy** — LOW — tied to graph activation, observability, trust-boundary mode.
- [ ] **AP-012 Redesign packaging around open-core + hosted trust ops** — LOW — Community/Pro/Team-Enterprise matrix; pricing metric must not be "per active agent session."
- [ ] **AP-013 De-risk economy language in ADR-0014** — LOW — explicit layering of work agreements / evidence / escrow / receipts / credit economy.

**Cluster D — Brand and narrative:**

- [ ] **AP-014 Decide external narrative center of gravity** — LOW — pick one of: practical local coordination / formal trust-control plane / agentic-economy infrastructure.
- [ ] **AP-015 Evaluate `agentsd.ai` as external brand** — LOW — brand decision memo. Partially in flight per existing `docs/AGENTSD_*` quarantine.
- [ ] **AP-016 Create claims taxonomy for site language** — MEDIUM — registry table dividing claims into true-now / true-but-rough / planned / prohibited overclaims. Recommended in "Immediate Next Slice."

**Cluster E — Website and rebrand execution:**

- [ ] **AP-017 Preserve agentsd mock visual system without inflated claims** — LOW — design carry-forward memo.
- [ ] **AP-018 Audit protocol-version / verification claims across `website-v2`** — MEDIUM — per-file audit + claim-by-claim corrections. Known contradictions: `website-v2/src/data/product.ts` still describes harbors as HMAC while protocol is Ed25519; `website-v2/src/pages/RoadmapPage.tsx` reflects older phase model; whitepaper page count disagrees between site and repo. Recommended in "Immediate Next Slice"; depends on AP-016. <!-- cite-exempt -->
- [ ] **AP-019 Rebuild website IA around operator trust** — LOW — preserve hero / proof / architecture / monetization / docs sequence.
- [ ] **AP-020 Choose right typography + identity system** — LOW — structural/industrial, not trendy.

**Cluster F — Public roadmap translation:**

- [ ] **AP-021 Reconcile public roadmap with current recovery authority** — LOW — public roadmap is diverging from `docs/recovery/CURRENT-WORK.md`.
- [ ] **AP-022 Map graph activation to economic + marketing readiness** — LOW — explicit dependency note: `graph_edges` → episodic memory → merge queue → evidence-backed economy claims → pricing/risk language. Plan warns future agents are likely to misread this as copy work.

### Cluster WORKTREE-SWARMS — Stigmergic isolation + parallel coordination

Source: `docs/plans/WORKTREE_SWARMS.md` (updated 2026-03-12). Harbormaster (ADR-0037 / PR #141) is the named implementation of the Janitor Agent idea from §4 of this plan; the remaining three roadmap items are unmapped elsewhere. <!-- cite-exempt -->

- [ ] **Worktree-Harbor binding** — MEDIUM — update `lib/harbors.ts` to allow pinning a Harbor to a specific set of `worktree_ids`. Currently Port Daddy auto-detects `worktree_id` on agent registration but harbors are not worktree-scoped. Roadmap item §6.1.
- [ ] **Metadata decay daemon (Evaporation)** — LOW — background process in the daemon that slowly reduces the weight of stale metadata pheromones. Pheromone read-time decay shipped (V4 roadmap §3-27); background evaporation is the missing companion piece. Roadmap item §6.2.
- [ ] **Swarm visualization dashboard** — LOW — update `website-v2` dashboard to show agents swarming across worktrees in real-time. Pairs with V4 roadmap's "Remaining: Dashboard visualization panel" note for the pheromone primitive (line 438). Roadmap item §6.3.

Owner: Cartographer (this ingestion). Each item's actual owner is whoever
picks it up. Cross-references: TUBE blockers gate Phases 3/4/6 of the
substrate roadmap; phone-integration C2 (Cloudflare Worker relay) is the
natural shape for the GitHub App webhook receiver chad in PR #166; AP-006
(daemon-hardening) is the protocol-truth counterpart to the runtime
hardening work already tracked in CURRENT-WORK queue items.

### Fleet CSP protocol gaps (from docs/FLEET-CSP-PROTOCOL.md)

Concrete invariants and primitives the protocol spec promises that aren't fully wired today.

- [ ] **FleetDAG static validation** on YAML load — `fleet-engine.ts loadFleetConfig()` should run a topological sort of the trigger graph and refuse cyclic configs. Today the rule is enforced "by construction" via humans reading the yml; no static check.
- [ ] **Singleton enforcement audit** — spec says `running.has(agent.name)` gate exists for `singleton: true` agents. Verify it actually fires for Spark + Spider on the live daemon; today's salvage queue suggests concurrent instances have shipped before.
- [ ] **Channel-bounded sampler** — Arbiter invariant `ChannelBounded` (every channel `<= MaxMessages`) is documented but not wired as a sampled (10s) check.
- [ ] **AgentTerminates sampler** — same: 60s sampled check for agents running past timeout, with auto-kill, isn't wired.
- [ ] **BlackboardSWMR static validation** — single-writer-multiple-reader per output dir (e.g., `.spark/ideas/` written only by Spark). YAML-load validator should refuse two writers to same dir.
- [ ] **Typed channels** (FleetChannelMap discriminated union) — channels are still untyped JSON. Producer/consumer agreement is by convention.
- [ ] **Confidence scoring in message envelope** — protocol promises `{agent, channel, confidence, coverage, duration_ms, files_examined, issues_found, payload}` shape. Today fleet messages don't carry confidence/coverage fields.
- [ ] **TLA+ FleetProtocol.tla mechanization** — spec is written inline in the doc (section 6). Should live at `proofs/fleet/FleetProtocol.tla` and run in CI alongside the claim_signaling.tla model from PR #136. <!-- cite-exempt -->
- [ ] **Gather policies** (`gates:` YAML stanza with `requires: / policy: all|majority|any / timeout:`) — proposed but not implemented. The "release readiness" RELEASE_CHECK example in §3 is aspirational.
- [ ] **Conversation protocols** (FIPA-style CRITIQUE_REFINE state machines) — §9.2 future work. PR #163's dispatch state machine is the closest live implementation.
- [ ] **Semantic channel routing via trie** — §9.3 future work. PR #122's `pd whois` scaffolding is the substrate; channel-subscribe-by-pattern (`port-daddy:fleet:qa:*`) isn't wired.

Provenance: `docs/FLEET-CSP-PROTOCOL.md` v1.0 draft 2026-03-27. Section 7's enforcement table maps each invariant to its check strategy.

## Session backlog 2026-05-21 (Cartographer ingestion)

Twenty-four hanging chads from the 2026-05-21 major session, ingested so
nothing falls on the floor. Each entry is the smallest thing that has to
happen to close the chad; priority is HIGH / MEDIUM / LOW / BLOCKED with
the originating PR or task ID stamped next to it.

### Critical / time-sensitive

- [ ] **brew formula bump to port-daddy 3.15.0** — HIGH — `curiositech/homebrew-tap` Formula. Operator's brewed daemon is 3.14.1; the Cloudflare fix shipped in 3.15.0. Needs version bump + checksum + bottle. Until this lands, operators who installed via brew keep running pre-fix code.
- [ ] **GitHub App webhook receiver code** — HIGH — follow-up to PR #146. PR #146 shipped auth + post-as primitive but no webhook handler. App cannot react to events autonomously without it. Cloudflare Worker is the natural shape.
- [ ] **App registration on github.com** — HIGH (BLOCKED on operator) — operator-action step. Without it the App doesn't exist. Pairs with the receiver above; receiver code can be written before registration but can't be tested end-to-end without it.
- [ ] **server.ts transcripts wiring** — MEDIUM — three lines deferred from PR #140; blocked on `cockpit-phase-2-commit` session's stale claim. Mechanical once the claim is cleared.
- [ ] **CLI-tube `--session-id` / `--continue` wiring** — MEDIUM — folded into PR #163 scope; already sent to the dispatch agent's inbox. Verify on landing; multi-turn dispatch (operator review → redo with prior context) does not work without it.
- [ ] **FCC Backend section (Swift port from dashboard panel)** — MEDIUM — PR #138 stripped the dashboard nav; full FCC port deferred. Pairs with chad #21 (dead panel-backend cleanup once port lands).
- [ ] **FleetBar Swift build verification** — LOW — needs Xcode build cycle. Raise to MEDIUM/HIGH only when someone is releasing FleetBar.

### Whitepaper work parked

- [ ] **Anchor paper Bonded-style upgrade** — MEDIUM — Task #100. Parked since session opener; agent originally dispatched then blocked on `pdflatex` permission.
- [ ] **v2.6 dialogue-synthesis line-edits to `.tex`** — MEDIUM — PR #155 shipped the synthesis list; actual `.tex` edits unapplied.
- [ ] **Federated Harbor actual paper** — LOW — proposal + bibliography exist; paper unwritten. Raise only when operator wants to ship it.

### Cleanup chads

- [ ] **TLA cherry-pick onto locked worktree** — LOW — PR #136 forked from a locked worktree; needs `7045fb15` cherry-picked onto its base.
- [ ] **Apalache CI install caching** — LOW — PR #136 downloads 130MB per CI run. Could cache.
- [ ] **Wave C archive of 9 superseded branches** — LOW — Task #141. `git branch -D` after operator confirms each.
- [ ] **Wave C SDK scaffold push** — MEDIUM — Task #141. Worktree `worktree-agent-ae6d3cf7daa216197` holds the clean `@port-daddy/client` package. PUSH + open PR.
- [ ] **Wave C 3 needs-review branches** — LOW (operator decision) — winget install claim / ProVerif maturity dispute / skill-prologue deletions.
- [ ] **Worktree pruning** — LOW — 109 worktrees on this checkout; many `.claude/worktrees/agent-*` from the 2026-05-21 session should `git worktree remove` after their PRs land.

### Substrate work

- [ ] **`pd guard install` also installs pre-push hook** — LOW — PR #161 has installer at `scripts/install-pre-push-hook.sh`, but `pd guard install` doesn't call it yet.
- [ ] **`pd guard destructive-log` CLI** — LOW — PR #161 logs bypass to `~/.port-daddy/destructive-ops.log`; no pretty-print CLI yet.
- [ ] **`pd nightshift` deprecation banner removal** — LOW — PR #163 keeps the alias for one minor version. Remove after.
- [x] **`merge_policy: 'auto'` actual implementation** — SHIPPED via `lib/dispatch/auto-merge.ts` (CI-green + mergeable + 0-unresolved-threads gate, then `gh pr merge --squash`), a daemon-side sweep interval, `pd dispatch merge-sweep`, and a `pd done` confirmation hook. Deliberately NOT routed through `pd harbormaster` (PR #141's operator-approval two-key queue) — that remains the `pd review --accept` path for `merge_policy='review'`.
- [ ] **Dashboard `panel-backend` dead-code cleanup** — LOW — PR #138 stripped the nav-item; the `panel-backend` div + `refreshBackend()` JS still live as dormant code in `public/index.html`. Clean up after the FCC port lands (pairs with critical chad #6).
- [ ] **MCP tool registration for `pd backend`** — LOW — manifest+completions are green via `routes=[]` punt; if any MCP client needs to call `pd backend`, registration is missing.

### Coordination doctrine

- [ ] **`pd whois` (talent phonebook)** — MEDIUM — PR #122 draft. The router primitive that should run before every agent dispatch. Operator wants this normalized; pairs with the `pd-talent-phonebook` memory item.
- [ ] **`pd attention` adoption verification** — MEDIUM — shipped already, but agents (including this one) aren't reliably running it at session start. Verify the `SessionStart` hook is firing in the Claude Code harness; if not, fix wiring.

Owner: Cartographer (this ingestion); each chad's actual owner is whoever
picks it up. Cross-reference: the GitHub App receiver, App registration,
and 3.15.0 brew bump form a single delivery cluster — finishing only one
of three leaves an inert system.

## Immediate Next Cuts

1. Cut and validate the maritime actor foundation slice, then promote/restart so live `/actors` and `pd actor(s)` match source.
2. Cut and validate the event-driven Tree-sitter symbol refresh slice, then verify it against the live daemon with real git and watcher events.
3. Decide commit-versus-quarantine for the tuple/graph/memory/semantic slice; do not leave it as ambiguous crash residue.
4. Fix Coxswain coordination debt next: filepath locks or explicit semantic syntax, lease-aware `who-owns`, stale asset reclaim, and claim/mutation graph edges.
5. Finish spawn discipline in the live fleet: cooldown, dedupe, backoff, singleton, project caps, visible queue state, and manual upkeep room.
6. Verify FleetBar/control-plane project truth after promotion: registered dormant projects must show up, embedded chrome must stay collapsed, and project switching must not strand the operator.
7. Verify sortie launch end-to-end from installed CLI and live UI; capture the exact Claude SDK readiness/reset path if it still reproduces.
8. Repair remaining file-action truth where relative mutation paths still fail to resolve in web or native surfaces.
9. Root-cause active-port/zombie-claim inflation if `port-daddy status` reports rows that cleanup cannot free.
10. Add Cloudflare research notes before expanding beyond Workers AI runtime support: official Workers AI, AI Gateway, Vectorize, AI Search, auth, limits, pricing, and telemetry behavior.
11. Fold `docs/plans/agentsd_ai_technical_architecture.md` into the live recovery story by mapping each shared-medium, actor, revocation, graph-memory, and remote-harbor idea to a concrete queue item. <!-- cite-exempt -->
12. Convert `docs/reports/GOOGLE_AGENTS_CLI_RESEARCH_2026-04-24.md` into a concrete Port Daddy lifecycle IA proposal before the public/operator docs split drifts further.
13. Keep the full test suite in the operator loop: focused bundles for iteration, full `npm test` before broad health claims, and failing files/root-cause hypotheses recorded here when the suite fails.

## Newly Confirmed Truths

- The operator surface now has a proper machine action for files, not just text: the daemon exposes `/operator/open-file`, the web control plane calls it, and FleetBar mirrors the same two affordances natively (`Open in Finder`, `Open with default editor`).
- Fleet project truth was one of the remaining big operator lies. `/fleet` only described live loaded fleets, while the UI treated that as the complete project universe. The current working tree now merges `/projects` with `/fleet` in both FleetBar and the web control plane, and `/fleet/config/:project` can resolve a registered stopped project instead of only a running fleet.
- `tests/unit/semantic-index.test.js` and `tests/unit/tunnel-lifecycle.test.js` were legitimate archaeology, not dead scratch. They passed and are now committed.
- The old `tests/unit/spawner-commit-0df9155-bugs.test.js` archaeology file was retired instead of promoted. The only useful assertions were folded into `tests/unit/spawner.test.js`; the rest duplicated existing coverage or canonized known-bad behavior. <!-- cite-exempt -->
- The spawner heartbeat timer was another real Jest open-handle culprit. `lib/spawner.ts` now `unref()`s that interval so blocked-spawn tests do not hold the process open just by reaching the concurrency ceiling.
- Port Daddy now has a real `codex` backend path in source. It shells out to `codex exec`, captures the final assistant message from `--output-last-message`, and unit coverage now exercises readiness, spawn dispatch, model catalog, and opaque-cost estimation for that backend.
- The first live Codex dogfood launch succeeded end-to-end through Port Daddy after replacing the stale manual daemon on `127.0.0.1:9876`: backend `codex`, model `gpt-5.4-mini`, output `codex backend smoke from port-daddy`.
- A second live Codex smoke now also proves the tier plumbing through the daemon, not just the runner: `port-daddy spawn --backend codex --tier low ...` returned `codex tier smoke through port-daddy`.
- Distinct low/mid/high model tiers now exist for every backend instead of only the hosted runtimes:
  - Claude SDK: Haiku / Sonnet / Opus
  - Claude CLI: haiku / sonnet / opus
  - Gemini: 2.0 Flash / 2.5 Flash / 2.5 Pro
  - Codex: gpt-5.4-mini / gpt-5.3-codex / gpt-5.4
  - Ollama: qwen2.5-coder:7b / llama3.1:8b / qwen2.5-coder:14b
  - Aider: gpt-4.1-mini / gpt-4.1 / gpt-5
  - Custom: custom-low / custom-mid / custom-high (forwarded via env so wrappers can honor it)
- The live Codex dogfood also surfaced two operator bugs that belong in the recovery queue, not chat memory:
  - file actions still fail on some relative mutation paths (`Not Found`)
  - fleet spawn counts can still run too hot for real model-usage scarcity
- Port Daddy's own `pd-fleet.yml` is now local-first by default: background/read-only agents use Ollama, code-changing agents use cheaper Codex tiers, and hosted backends are opt-in instead of the silent default.
- The local runtime ladder is now actually provisioned on this machine: Aider is installed, Ollama is healthy again, and the recommended Ollama models (`qwen2.5-coder:7b`, `llama3.1:8b`, `qwen2.5-coder:14b`) are pulled locally.
- Source truth and live-daemon truth still have to be checked separately for Ollama tiers. The repo now points mid-tier Ollama to `llama3.1:8b`, but stale manual daemons can still serve the old invalid `llama3.2:8b` mapping until the canonical runtime is restarted.
- Embedded FleetBar routing needs two signals, not one: query-param embed plus an explicit WebView identity. Relying on `?embed=fleetbar` alone is brittle enough that duplicate chrome can come back.
- The modern fleet engine already scopes logical channels like `git:committed` through `lib/fleet-channels.ts`. If cross-project triggers still bleed, the likely culprit is leaked legacy detached watcher processes, not missing scoping code in the current runner.
- `port-daddy status` and browser reachability are separate truths. The CLI can look healthy over the Unix socket while TCP/browser consumers are still pointed at a brittle loopback URL or stale port assumption.
- The daemon should not permanently skip a project when lease renewal returns `lock not held` and `locks.check()` reports no holder. That is an empty-holder recovery case, not proof another daemon owns the fleet.
- The richer native/control-plane detail views need briefing payloads to carry explicit `summary` and `files`, not just raw activity prose.
- The current daemon-served bundle now renders embedded `Flow` and `Activity` without the inner header/tab stack. The native shell owns surface navigation, theme, and daemon chrome.
- Activity is no longer the empty liar from the earlier screenshot. The served `Activity` surface now shows project-scoped notes again after restoring `story.agentId` attribution and surfacing meaningful event types.
- The concrete Activity bug was project filtering: story notes were still being matched on free text and `identityProject`, but not `story.agentId`, so valid project-scoped handoffs could disappear from the main timeline.
- `pd init` was still writing its own bespoke post-commit hook body. The installer now copies the shared scoped hook template so hook behavior can stop drifting by command surface.
- `pd fleet` status was still sampling naked logical channels like `git:committed`. The operator-facing recent-event check now resolves those through the project-scoped physical channel path.
- Remaining `9876` drift still exists in docs/templates and some operator labels even after the runtime callers were cleaned up.
- The earlier `embed-flow-after` proof was wrong because it captured a loading state. A fresh settled screenshot now confirms embedded `Flow` does render the graph and agent cards correctly from the daemon-served bundle.
- Session notes already carry `agentId` and `identityProject` on the backend; the remaining bug is frontend attribution code still dropping that metadata and guessing from content.
- The activity bug was deeper than the UI. Recent project activity was being queried by `target_id` prefix even though real session and sugar rows often had `target_id = null`, so project-scoped Activity and FleetBar recent work could lie by omission.
- The live installed `.git/hooks/post-commit` in this checkout was still the pre-scope Port Daddy hook, publishing naked `git:committed`. Shared templates were correct, but installers were treating any hook mentioning `git:committed` as already upgraded.
- The fix is now source-level, not cosmetic:
  - session/file/sugar activity stamps `agentId`, `targetId`, and `identityProject`
  - briefing rebuilds project activity from structured metadata, session membership, and active agents
  - legacy Port Daddy hooks auto-upgrade in `pd init` / `pd fleet init`
- The monolithic CLI still had an old freshness auto-restart path in `bin/port-daddy-cli.ts`. Without a same-install-root guard, stale watcher processes from another checkout could decide the canonical daemon was "stale" and SIGTERM it. That path now only restarts for interactive commands from the same checkout as the live daemon.
- Detached watcher archaeology is real. Killing the old top-level `port-daddy-cli watch ...` roots removed the repeated cross-checkout daemon killings; background commands must not get daemon freshness authority back.
- Daemon-owned fleet watchers were still spawning detached `pd watch ... --exec` children for YAML watcher entries. That is now treated as a runtime-hardening bug, not normal fleet behavior: daemon-managed watchers should subscribe through the in-process message bus and spawn only the configured one-shot exec on actual messages.
- Standalone `pd watch` clients must not reset reconnect backoff on denied SSE responses. A 429 from `/msg/.../subscribe`, `/fleet/events`, or `/activity/subscribe` now carries `Retry-After`, and watch clients preserve backoff pressure unless they establish a real `text/event-stream` connection.
- The daemon's Bosun heartbeat interval is mandatory liveness and must stay referenced. SDK/spawner helper heartbeats may use `unref()` to avoid test/process leaks; the daemon heartbeat cannot, because a stale heartbeat makes Bosun kill the canonical runtime.
- FleetBar hits `/projects` during startup, so that route is heartbeat-critical. Default project discovery must stay bounded, must not scan the user's home directory from the stable checkout, and must stop at Port Daddy project boundaries instead of walking repo caches or generated work dirs.
- Runtime discovery now drives more of the real product surface: the JS SDK, MCP server, and FleetBar stores no longer default inline to `http://localhost:9876`; they resolve the live daemon URL through the shared discovery path or the user port file.
- A fresh control-plane load now resolves logical channel names like `git:committed` to physical project-scoped channels before polling or publishing. Older already-open FleetBar/browser clients can still hit naked channels until they reload, so mixed daemon logs after a bundle change do not automatically mean the new bundle is wrong.
- Only `Flow` still warrants the persistent project rail. `Activity`, `Channels`, `Inbox`, `Sorties`, and `YAML` behave better as full-width top-level pages.
- FleetBar popover usefulness is now part of the active scope: recent per-agent summaries and touched files belong in the menu bar companion, not only in the full control center.
- Current build state after the latest control-plane and FleetBar edits: root `npm run typecheck`, `cd fleet-config-ui && npm run build`, and `cd apps/FleetBar && env CLANG_MODULE_CACHE_PATH=/tmp/clang-module-cache swift build` all passed.
- The sortie composer had a truth bug: after launch it recreated a fresh draft with the hardcoded `claude-cli` default, which made a Claude SDK attempt look like it silently reverted runtimes even when the real outcome was elsewhere.
- Generic `POST /spawn: 400 Bad Request` UI errors are not acceptable operator feedback. The control plane must surface the daemon’s actual `error` / preflight blocked reason inline.
- Claude SDK readiness was also lying by omission: env presence alone was enough to show “ready” even when `@anthropic-ai/sdk` was not installed.
- Activity cannot key its entire left rail off “agents with signals” only. If the project log has meaningful work but the left rail says “no signals,” the operator experience is lying by omission.
- Activity click behavior should focus the in-page activity view, not reopen the global slide-in Flow inspector. Overlapping detail surfaces are harder to reason about than one truthful one.
- Spark scratch was already correctly treated as local residue via `.gitignore`; the analogous spider connection note pile belongs in the same default-ignore bucket unless later curated intentionally.
- `.dogfood/` is the same class of residue as `.spark/` and `.spider/connections/`: useful locally, not repo truth by default.
- We copied the unique stable-only Spark/Spider markdown outputs into this checkout so idea archaeology now lives in one place. That does not make every copied file roadmap truth; it just removes the excuse to keep mining the stable repo for “one more missing note.”
- `/Users/erichowens/port-daddy-stable` was used as a live Port Daddy workspace. It has its own `pd-fleet.yml`, daemon DB/logs, `.spark/`, `.spider/`, and tracked build garbage. Promotion failures there are partly operator contamination, not just merge luck.
- The stable checkout is not secretly better than current main. The salvageable pieces are discrete Spark/Spider ideas and maybe a few source edits, not the checkout as a whole.
- The full Jest suite is green again as of `2737816`: `103/103` suites, `4510/4511` tests, `1` skipped. The remaining lie to hunt is the parallel-run worker-force-exit warning, not red suite failures.

## Explicit Non-Goals For This Pass

- New speculative agent products
- More website polishing unless it fixes a lie about live behavior
- Broad economy work beyond budget/cost truthfulness

## Operator Rules

- Update this file when the active recovery queue changes.
- Update `.cartographer/status.md` when the center of gravity moves or a track closes.
- If chat and this file disagree, fix this file first.
