# Harbor Console — the build DAG (hypertree decomposition)

*Structure phase only (per hypertree-planning: decide **what needs handling** before
**how**). Decomposition is expressed as **rules**, not examples, so it generalizes.
Width — not node count — is the coordination cost (dag-fast-decomposition).*

---

## 1. Decomposition rules

```
[Harbor Console]  →  { [Loop-UI], [Editor], [Viz], [FleetBar], [Coordination], [Conjure] }   # 6 ⟂ chains (hyperlink)

[Loop-UI]   →  { [surface] | surface ∈ {Fleet, Dispatch, Decisions, Cost, Map} }  # parallel, independent
[surface]   →  ⟨ data-bind → interaction(↑↓ / click / ⏎ / ←) → visual(tokens+motion) → action(daemon verb) ⟩
                                                                                   # ← the leaf RECIPE (reused for every surface)
[Editor]    →  nested-seq( P0 surface → P1 Loro buffer → { transport ⟂ peers+claims } → salvage → shared → remote )
                                                                                   # COUPLED — keep sequential, don't fake parallel
[Viz]       →  { harbor-water ⟂ periscope }  ⊥  embed-plumbing                    # parallel; both shader protos exist
[FleetBar]  →  nested-seq( enumerate → select → launcher )                         # independent track
[Coordination] → { backend-authoritative, daemon-resilience, route-fixes }         # cross-cutting, mostly daemon-side
[Conjure]   →  nested-seq( PredictedDAG types → prompt/CLI generation → Vello PNG → inspector → dispatch-gated nodes )
                                                                                   # DONE — operator prompt blooms a skill-agent DAG
```

The **leaf recipe** is the load-bearing rule: every UI surface is the same four-step
chain (bind data → wire interaction → apply tokens+motion → call the daemon verb).
That single rule covers ~15 surfaces with no per-surface example needed.

## 2. Width = coordination cost (the only edges worth managing)

Six chains ⇒ **width 6**: six actors can work in parallel. Density is high but most
edges are *transitive noise*. The **generative cross-chain edges** — the entire real
coordination surface — are just three:

```
shell (mux/Workspace/Pane)          ──▶  every Loop-UI + Editor surface     [EXISTS ✅]
daemon governance (claims/predict/  ──▶  Editor peers+claims, Loop-UI actions[EXISTS ✅]
  salvage/cards, routes/symbols.ts)
Loop-UI: Fleet roster (A1)          ──▶  Editor "open the file agent X edits" [hero→editor seam]
Conjure: generated skill DAG        ──▶  Dispatch + spawn governance          [DONE ✅]
```

Both load-bearing prerequisites already ship. So coordination reduces to: **don't two
agents touch the same chain at once** — and the chain boundaries are the claim
boundaries. Conjure is now a finished independent chain: keep it available as the
operator's "turn this goal into a visible, dispatchable skill DAG" surface while the
Fleet/Edit/Viz tracks continue.

## 3. Waves (topological layers)

| Wave | Nodes | Unblocked by | Skill lane |
|------|-------|--------------|-----------|
| **0 ✅ done** | NAV rail · token alignment · alert bus · HITL surface | shell | beautiful-gui-design, rust |
| **1 — hero** | **A1 Fleet roster** (↑↓/sort-by-needs-you) → **A2a Join+live transcript** ✅ (click/↑↓/⏎/←) → **A2b/S3 steer in joined chat** ✅ (compose+Send · role bubbles · inline HITL) → **S4 spawn→auto-join** ✅ · **A3 slim rail→6 pages** | shell, daemon | frontend-design + gpui-motion + rust |
| **2 — parallel** | A4 Dispatch(spawn+review) · A5 Decisions cards · A6 Cost · A7 Map tabs · **D1 FleetBar berth** · **B0/P0 Editor surface** · **C1/C2 shader companion** · **E Conjure prompt→DAG** ✅ | W1 (UI), shell (B0/C), none (E) | per-leaf recipe; shaders; rust; dag-orchestrator |
| **3** | B1 Loro buffer + authorship gutter · D2 FleetBar launcher · C3 embed-plumbing | B0; D1; C1/2; A2 | build-coop-ide-gpui; vello/metal (Rung 1) |
| **4** | B-transport (SyncTransport) · B-peers+claims (/conflicts/predict band) | B1, daemon | build-coop-ide-gpui |
| **5** | B-salvage (the wedge) · B-shared harbor · sound cues (≤6 earcons) | W4 | sound-design |
| **6** | B-remote+E2E · living-harbor embed | W5 | gpui-shaders, capstone |

**Rule honored (capstone):** buffer + coordination before transport polish; never the
Potemkin editor (B-salvage is W5, *not* deferred away).

## 4. Port Daddy coordination — DEDUP against live sessions

`pd sessions` shows **parallel pd-console work in flight** — these are real cross-chain
edges with *humans/agents*, the actual coordination risk:

- `session-p1-pd-console-fleet-lifecycle-pane` (2579bfb0, 5h, **16 files**) — **de-conflicted:
  it owns the Fleet pane's lifecycle-state rendering + waving ICS flags** (`WavingFlag` gpui
  paint element, `FlagMotion`, the `pd-flag-proto` Vello/wgpu companion + offscreen-capture
  artifact harness). It does **not** build A1 roster interaction or A2 join→chat. **Shared
  edge:** we both edit `app.rs`'s Fleet surface — split by sub-region: **they own
  `Block::Flag`/`FlagBadge`/lifecycle visuals; I own roster selection/sort + the
  `AgentTranscript` join flow.**
- `session-off-screen-visual-proof-harness-for-pd-console` (76e02a1c) + the `pd-flag-proto`
  Method-A offscreen capture — the visual-artifact gate (no-UI-merge-without-artifacts).
  **Reuse this harness** for A1/A2 screenshots, don't rebuild.
- `session-pd-console-gui-first-operator-surface` (91e13bb8) — **this session**; NAV rail
  landed here (cb6280bc).

**Coordination protocol going forward:** claim a *chain*, not scattered files; the chain
boundary IS the claim boundary. For Wave-1, coordinate the `app.rs` Fleet sub-region split
with 2579bfb0 (they: flag/lifecycle visuals; me: roster interaction + join→chat) before editing.

## 5. Chain closed — E Conjure prompt → skill DAG → Vello → dispatch

Status: **DONE as of 2026-06-27** in `harbor-p1-resize`.

Closed nodes:

- ✅ E1 `PredictedDag` / `PredictedWave` / `PredictedNode` serde model and block renderer.
- ✅ E2 operator toolbar `Conjure` prompt; live `claude:cli` generation with deterministic fixture fallback when provider/auth is unavailable.
- ✅ E3 offscreen Vello renderer handoff through `core/pd-conjure-proto`; inline PNG path is wired back into the GPUI pane.
- ✅ E4 inspector/context partition markers: full deps, compressed waves, shared whiteboard, token budget, and in/out contracts.
- ✅ E5 `Dispatch DAG` action: non-HITL nodes route through the existing daemon spawn path; gated nodes are held back.

Validation:

- `cargo build --features gpui --bin pd-console` — passed.
- `cargo test` in `core/pd-console` — passed.
- `cargo test conjure::tests` — 29 passed.
- `bash core/pd-conjure-proto/scripts/capture.sh fixture.json conjure-dag-vello.png` — passed; generated `core/pd-conjure-proto/conjure-dag-vello.png` at 2448×1220.
- `mcp__windags.windags_next_move` — blocked by invalid Anthropic API key (401), which exercises the current Conjure fallback path rather than the future clean `windags_next_move` adapter.

Known validation caveats:

- `cargo test --features gpui --bin pd-console conjure::tests` hit rustc SIGBUS in `gpui_macros` while compiling the test binary; the GPUI app build itself passed.

## 6. Chain closed — A2a/A2b Fleet roster → bound live transcript → steer

Status: **DONE for join + joined-chat steering as of 2026-06-27** in `harbor-p1-resize`.

Closed nodes:

- ✅ Fleet roster rows now carry a semantic `agent_id` in `Block::AgentRow`, not an id parsed out of display text.
- ✅ Click a Fleet row or use ↑/↓ then ⏎ to swap the focused pane into `AgentTranscript { agent_id: Some(...) }`.
- ✅ `LanePane` can pin to that exact agent via `ControlMsg::WatchAgent`; the SSE subscription reopens when the target changes.
- ✅ Escape/← returns the focused pane to the Fleet roster and clears the pin so the generic Lane returns to newest-active behavior.
- ✅ Spawn and Cartographer actions also clear the pin before opening the generic live lane, so a newly launched agent is not hidden behind an old join target.
- ✅ The joined transcript has a visible compose field and Send action.
- ✅ Enter or Send publishes the operator turn to `agent:<id>` through daemon `tube_send`, with success/failure surfaced on the alert bus.
- ✅ The compose buffer clears on send, Back/Escape, and join-target changes so text never leaks between agents.
- ✅ Transcript frames render as role-aware bubbles (`you`, `agent`, `tool`, `system`) through the shared `Block::TranscriptBubble` contract.
- ✅ HITL-shaped stream frames render inline as `Block::HitlCard` cards with Approve / Adjust / Deny controls.
- ✅ Approve/Deny emit structured `hitl.<verdict> <request_id>` turns back to `agent:<id>`; Adjust pre-fills the compose bar with `hitl.adjust <request_id>:`.
- ✅ Manual Spawn successes carry the exact new agent id on `Alert::spawned`; the foreground consumes it and immediately binds the focused transcript to that agent instead of hoping the newest-active heuristic picks the right one.

Validation:

- `cargo build --features gpui --bin pd-console` — passed.
- `cargo test` in `core/pd-console` — passed: 146 unit tests plus live integration suites.
- `cargo test --test lane_live` — passed: 15 tests, including the live SSE socket stream.
- `git diff --check` — passed.

Still open in the broader hero/product chain:

- **A3** slim rail → 6 loop pages, absorbing the low-frequency surfaces as tabs.
- Dispatch review queue, Decisions aggregate, Cost roster, and Map tabs as the next page-level loops.
