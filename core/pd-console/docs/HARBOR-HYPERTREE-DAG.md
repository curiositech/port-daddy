# Harbor Console — Hypertree DAG (structure phase)

*Decomposition outline for the Zed-killer operator console (M humans + N agents).
Built with the hypertree method: a parent hyperlinks to a **set of independent
branches**; nest only where genuinely sequential. Structure first — leaf content
(the exact code) is filled per-node, not committed up front. Coordinated through
Port Daddy against live swarm ownership (read 2026-06-24).*

## Decomposition rules (generalized, not examples)

```
[Harbor Console] → { [Operator Loop UI], [Harbor Editor], [Ambient Viz], [FleetBar], [Coordination], [Conjure DAG] }   ⊥ independent
[Operator Loop UI] → { [surface] : surface ∈ loop-stages }                                              ⊥ parallel
[surface]          → { data-binding, interaction(↑↓·click·⏎·←), visual(tokens+motion), action(daemon verb) }   ← leaf rule
[Harbor Editor]    → nested-seq( P0 Editor-surface → P1 Loro-buffer → {SyncTransport ⊥ agents-as-peers+claims} → salvage → shared → remote )   ← coupled
[Ambient Viz]      → { harbor-water, periscope-sonar } ⊥ embed-plumbing                                  ⊥ parallel
[FleetBar]         → nested-seq( enumerate-berths → select-target → dev-launcher )                       ← coupled
[Coordination]     → { backend-authoritative, daemon-resilience, route-fixes }                          ⊥ cross-cutting
[Conjure DAG]      → nested-seq( typed-DAG → prompt generation → Vello graph → inspector → gated dispatch ) ← DONE
```

The **leaf rule** is the reusable pattern: every UI surface = {data, interaction, visual, action}.
It generalizes across all loop surfaces, so we never hand-author each one from an example.

## Skill dispatch (which lens each branch pulls)

| Branch | Pulls |
|--------|-------|
| Operator Loop UI surfaces | `beautiful-gui-design` (tokens/contrast — audited) · `rust-gpui-motion` · `rust-with-claude-code` |
| Harbor Editor (B*) | `build-coop-ide-gpui` (Loro/claims/salvage) · `rust-with-claude-code` |
| Ambient Viz (C*) | `gpui-shaders` (water/sonar fragment pass) · `vello-parley-rendering` + `metal-text-pipeline` → **Rung 1 Vello/Parley** (≈0.5–2ms/frame @ M4 Max; do NOT drop to bare Metal) |
| Agent/model routing leaf | `ai-engineer` (tiered routing — `model-tiers.json` already exists) |
| Conjure DAG (E*) | `dag-orchestrator` + `vello-parley-rendering` + `agent-context-partitioner` lens; implemented as `core/pd-console/src/conjure.rs` + GPUI controls + `core/pd-conjure-proto` |

## Waves (topological layers) + Port Daddy ownership

**Wave 0 — foundation · DONE**
- ✅ NAV rail (clickable, replaces Ctrl-A) — `cb6280bc` (this session)
- ✅ Design-token system audited + mock stylesheet regenerated from canon (this session)
- ✅ Alert bus (#21) + HITL surface (#22)
- ✅ daemon `launchableUnverified` fix (this session; convergent w/ `da2ba0e9`)

**Branch E — Conjure prompt→DAG · DONE**
- ✅ E1 typed `PredictedDag` model + render-agnostic Block view.
- ✅ E2 toolbar prompt → live `claude:cli` generation, with prompt-titled fixture fallback when provider auth/tooling fails.
- ✅ E3 Vello/Parley offscreen graph renderer + inline GPUI PNG handoff.
- ✅ E4 per-node inspector: contracts, full deps, compressed wave summaries, shared whiteboard, token budget.
- ✅ E5 `Dispatch DAG`: non-HITL nodes route through daemon spawn; one gated/irreversible node is held back for explicit operator approval.
- ✅ Proof artifact: `core/pd-conjure-proto/conjure-dag-vello.png` rendered at 2448×1220 via Method-A capture.

**Wave 1 — the hero (S1→S3) · IN FLIGHT, COORDINATE**
- 🔶 **A1 Fleet roster — OWNED by `session 2579bfb0`** (`fleet_pane.rs`, lifecycle ships, maritime flags, `:fleet`). *Do not claim.* My contribution: hand them the IA + token spec (`CONSOLE-IA-AND-STORIES.md`). **Shared-file hazard: `app.rs` `render_block`/`Block::Flag` — coordinate before editing.**
- ✅ **A2a Join → live transcript** *(closed here)* — semantic `AgentRow.agent_id`, click/↑↓/⏎ joins `AgentTranscript { agent_id }`, Lane pins its SSE subscription, Escape/← returns to Fleet.
- ✅ **A2b/S3 Steer inside joined chat** *(closed here)* — compose+Send, role bubbles, inline HITL cards, and approval/adjust/deny tube responses.
- ✅ **S4 Spawn → exact live transcript** *(closed here)* — manual spawn success alerts carry `join_agent_id`; foreground binds the transcript to the exact new agent.
- ▶ **A3 Slim nav rail → 6 loop pages** *(my lane; I own the rail)*; absorb the other 15 surfaces as tabs.

**Wave 2 — parallel, mostly unblocked**
- A4 Dispatch (spawn+review unified, #41) · A5 Decisions cards (#33) · A6 Cost roster · A7 Map tabs (#25/#27/#28)
- C1 harbor-water shader · C2 periscope-sonar (protos + WGSL done) — land real captures via the **off-screen visual-proof harness** (`pd-flag-proto` Method-A). *Flags (C0) already owned by `2579bfb0`/pd-flag-proto — don't dup.*
- D1 FleetBar berth enumerate + selector (#45) *(my lane; independent)*
- B1 Editor surface P0 (read-only file view, #37) — dep shell only

**Wave 3** — B2 Loro buffer P1 (dep B1) · B3 SyncTransport trait · D2 FleetBar launcher (dep D1) · C3 embed-plumbing (companion→render-to-texture)
**Wave 4** — B4 agents-as-peers + claims + `/conflicts/predict` band (dep B2 + daemon claims)
**Wave 5** — B5 **salvage** (dep B4 — the wedge, don't defer) · B6 shared harbor (P4)
**Wave 6** — B7 remote harbor + E2E (P5)

## Standing gates (every node)
- No UI merge without visual artifacts in the test plan → use the **off-screen visual-proof harness** (Method-A, TCC-free) for gpui/Vello/wgpu surfaces.
- `cargo check`/`clippy`/`cargo test --bin pd-console-repl` green (non-gpui REPL bin; `RUST_MIN_STACK=16777216`).
- Backend-authoritative: console is a thin view; daemon owns truth (#40).

## Honest scope
Branches A (loop UI) + C (viz) + D (FleetBar) are near-term and largely parallel.
Branch E (Conjure DAG) is now closed and should be treated as the available operator
planning/dispatch surface, not future work. Branch A now has the A2a roster→live
transcript join loop, A2b/S3 joined-chat steering, and S4 spawn→auto-join closed;
the remaining hero work is A3 rail consolidation. Branch B (Harbor editor)
remains the multi-session capstone;
realistic first slice is **B1→B2**.
Retired: #32 (Ctrl-A consistency) — superseded by the GUI nav rail.

## Validation Snapshot — 2026-06-27

- `cargo build --features gpui --bin pd-console` passed.
- `cargo test` in `core/pd-console` passed: 146 unit tests plus integration suites.
- `cargo test --test lane_live` passed: 15 tests, including the live SSE socket stream.
- `cargo test conjure::tests` passed: 29 tests.
- `bash core/pd-conjure-proto/scripts/capture.sh fixture.json conjure-dag-vello.png` passed and produced a nonblank PNG.
- `windags_next_move` MCP is not currently usable on this machine because the configured Anthropic key returns 401; Conjure's shipped path falls back cleanly to the prompt-titled fixture.
