# Harbor Editor / Beat Zed Current State

Verified live on 2026-07-09 with `gh`, GraphQL mergeability, fetched PR refs,
the current `origin/main` tree, and the `build-coop-ide-gpui` refs 03/04.
This is a current-truth reconciliation doc, not a new architecture pitch.

This doc intentionally avoids new external platform or competitor claims. Treat
the battle plan's Zed/platform details as historical provenance until someone
refreshes them with live citations.

## 1. Landed Capability Matrix

| Area | Main has now | Only open PR / not landed |
| --- | --- | --- |
| Battle plan | PR #499 merged the Harbor Editor battle plan at `docs/strategy/harbor-editor-battle-plan.md`. | The old "first two weeks" section is historical. Do not treat it as the current next task. |
| P0 - read-only editor surface | PR #563 merged `SurfaceKind::Editor { path, region }`, `EditorPane`, `FileTree -> Editor`, `:edit <path>`, one-pane/two-faces rendering, and visual artifacts. | Nothing core is missing for P0, but the old Row renderer makes code look like status cards until the perf rescue lands. |
| P1 - CRDT buffer foundation | Main includes `core/pd-console/src/buffer.rs` with `HarborBuffer`, stable PD-identity-to-`PeerId` mapping, programmatic authored inserts, Loro export/import, snapshot export, and per-line authorship. `editor_pane.rs` renders the Loro-backed buffer and authorship gutter. | Full P1 is not complete: there is still no live GPUI text input element, no human keystrokes into the buffer, no undo-map, and no tree-sitter incremental reparse. |
| P2 - daemon-bus multiplayer substrate | PR #727 merged `editor_sync.rs`, edit-channel frames, presence frames, snapshot refs, op-log note codecs, `/blob` client verbs, `OpLog`, distinct edit vs coordination channels, and `Subscription::Editor { channel, coord_channel }`. | The current main app still treats editor subscriptions as "nothing to follow" in the producer loop. Live window wiring remains #729 material, not main. |
| P3 - agents-as-peers, claims, wedge, commit gate | PR #728 merged `editor_claims.rs`, `editor_wedge.rs`, `editor_commit_gate.rs`, region claims, pre-write conflict-predict request/response plumbing, bypass-free gated messages, staged-region commit gate, and MCP `claim_region` / `release_region`. | The primitives are on main, but the running GPUI app does not yet drive the live edit/coord channels into a persistent editor pane. That visible wiring is #729 material. |
| P3.5 - salvage demo | P2 provides the substrate: snapshots to `/blob`, op-log deltas to immutable notes, idempotent replay helpers, and cold-pane hydration tests. | The headline demo is not landed: no end-to-end dead-replica recovery that consumes `/recovery`, inherits a claim, replays the op-log into a live doc, and proves provenance in the visible editor. |
| Editor performance / code rendering | Current main still emits code as `Block::Row`, and `app.rs` constructs a fresh `EditorPane` for each render of an Editor surface. | PR #896 is the current rescue branch for the useful #883 work: `Block::CodeBuffer`, syntax runs, virtualized `uniform_list`, persistent editor state, headless raster parity. Its mergeability/check state changes as proof commits land. Treat the older #883 branch as mined material unless it is deliberately revived. |
| GPUI ecosystem survey | PR #885 merged `docs/design/2026-07-08-gpui-ecosystem-steals.md` and roadmap items. | Use that survey as planning input; do not re-state its external claims from memory. |

## 2. Open Dependency Map

Open PR branch roles, avoiding transient check snapshots:

| PR | Live state | Role | Recommendation |
| --- | --- | --- | --- |
| #729 | Open, non-draft live-wiring branch with stale/conflict-prone branch shape against current main. | Load-bearing live app wiring for P2/P3: persistent editor producer, edit/coord channel drains, live wedge Blocks, repl proof assets. | Do not merge as-is. Recreate or rebase it after #896, and after the #880 decision if #880 is still intended to land first. Keep its proof assets as evidence, but adapt the code to the current `CodeBuffer` direction. |
| #896 | Open, non-draft current rescue branch for the useful #883 work; mergeability/check state changes as proof commits land. | Rescues virtualized editor, syntax, persistent editor state, shared `CodeBuffer` surface, and headless raster coverage onto the current line. | Merge first after fresh branch-specific visual proof, checks, and reviews are accepted. This is the best base for any visible editor work. |
| #883 | Open, non-draft older aggressive perf branch with stale/conflict-prone branch shape against the #896 direction. | Original aggressive editor perf rebuild. It contains useful ideas but also stale branch-wide assumptions and roadmap churn. | Supersede/close after #896 lands. Mine only a named missing piece if #896 proves incomplete. Do not revive wholesale. |
| #880 | Open, non-draft broad cull branch with collision-prone console topology changes. | Broad pd-console cull and defect PR. It deletes/rewires many panes and mutates `main.rs`, `app.rs`, and `pane.rs`. | Decide before live-editor wiring. Either land/rebase it after #896, then build #729-successor on top, or explicitly park it so #729-successor does not chase a moving console topology. |

Recommended default order:

1. Land #896 once its fresh branch-specific visual proof, checks, and reviews are accepted.
2. Close #883 as superseded by #896.
3. Resolve #880 or park it explicitly. If landing it, do so before the #729 successor.
4. Build a fresh #729 successor on the resulting main, carrying only the live-editor wiring and proof assets needed for the current surface.

## 3. What Is Stale In The Old Battle Plan

- P0 is not a future task. It is merged.
- P1 is no longer blank. The CRDT substrate and authorship proof exist, but the live text input element is still missing. Relabel this as "P1 foundation landed; P1 interactive editing remains."
- P2 is not "go build LAN multiplayer from scratch." Main already has daemon-bus transport, presence, snapshot/op-log durability, and channel isolation. Relabel as "P2 substrate landed; live app subscription wiring pending."
- P3 is not "invent claims/wedge/MCP tools." Main already has region claims, pre-write wedge plumbing, commit gate, and MCP tools. Relabel as "P3 primitives landed; operator-visible live wiring pending."
- P3.5 remains the real headline wedge. The substrate exists, but the kill-agent/recover-work demo is still unlanded.
- P4/P5 topology work stays behind the wedge. Do not start iroh, remote relay polish, or a new sync backend before the editor can show governed co-editing in the running console.
- The "beat Zed" competitor framing should be treated as historical unless refreshed with live citations. The implementation roadmap does not need new competitor claims.

## 4. Next Landable Implementation PRs

### A. Live Editor Wiring Successor

Source material: #729, rebuilt on top of #896 and the #880 decision.

Scope:
- `core/pd-console/src/main.rs` for producer ownership of one persistent `EditorPane`.
- `core/pd-console/src/app.rs` for foreground binding and live block selection.
- `core/pd-console/src/editor_pane.rs` only for seam methods that survive #896's `CodeBuffer` shape.
- Optional proof-only files under a fresh `docs/pr-assets/pr-<new-number>/`.

Validation gates:
- Focused repl test proving live edit/coord frames fold into the visible editor state.
- `cargo test --manifest-path core/pd-console/Cargo.toml --bin pd-console-repl`.
- `cargo check --manifest-path core/pd-console/Cargo.toml --features gpui --bin pd-console`.
- Visual proof: current-branch GPUI screenshot/clip if available; otherwise an honest second-face raster/recording with a manifest explaining the gap.

Operator milestone:
- Erich can open a file in pd-console and see remote presence, region claims, predicted conflicts, and gated commit state in the running editor surface instead of only in fixtures/tests.

### B. Local Text Input Element

Scope:
- Prefer a new (proposed) `core/pd-console/src/editor_input.rs` for the custom GPUI text element.
- Small seams in `editor_pane.rs` and `app.rs`.
- No transport, no new backend, no claim policy changes.

Validation gates:
- Unit tests for insert/delete/selection/UTF-8 grapheme boundaries.
- CRDT test: keystroke -> `HarborBuffer` authored op -> `CodeBuffer`/line view update.
- Idle render test showing no full-file rebuild per keystroke.
- Visual proof: typing into a real file, author gutter updating, and no per-line card chrome.

Operator milestone:
- Erich can type into a Loro-backed local editor buffer in pd-console. It is finally an editor, still local and governed by existing lanes.

### C. Claim Acquire/Release UI And Durable Mirror

Scope:
- UI affordance in `app.rs` / `editor_pane.rs` for selection -> claim, release, and handoff/parley prompt.
- Use existing `editor_claims.rs`, `editor_wedge.rs`, `lib/editor-claims-mcp.ts`, and daemon session file-claim routes.
- No new claim store and no force/bypass affordance.

Validation gates:
- Daemon-backed test proving `POST /sessions/:id/files` and release calls are made with region scope.
- Wedge test proving `conflicts/predict` fires on claim acquire/region enter, not per keystroke.
- Guard-message scan for no bypass tokens.
- Visual proof: two regions in one file, one contested claim, gated chip, and a clean adjacent edit.

Operator milestone:
- Erich can select a symbol/region in pd-console, claim it, see who owns neighboring regions, and watch the guard suggest handoff/parley instead of silently merging intent conflicts.

### D. Salvage Replay And Claim Inheritance

Scope:
- A small salvage module around existing snapshot/op-log helpers and `routes/recovery.ts`.
- Tests in `buffer.rs` / `editor_sync.rs` for replay order, idempotency, and post-death document advance.
- UI surface in the editor for "dirty replica work available" and successor consume.

Validation gates:
- Property tests for dead-replica op-log replay onto an advanced doc.
- Route test for single-use recovery consume and immutable-note provenance.
- Visual proof: kill/recover scenario with recovered spans and inherited claim visible.

Operator milestone:
- Erich can kill an agent mid-edit and see a successor recover the actual work, not re-run the prompt.

### E. Capability Dry-Run In The Editor

Scope:
- Minimal P4 dry-run only: `routes/harbors.ts`, `core/harbor-card-rs`, and editor-side check rendering.
- No LAN/remote transport work.

Validation gates:
- Capability check tests for allowed/denied path or region.
- Editor test proving denied ops render `Tone::Gated` and do not name bypass flags.
- Visual proof: a write-cap denial before the op lands.

Operator milestone:
- Erich can see, inside pd-console, whether a participant may write a region before the editor accepts the op.

## 5. Risks And Non-goals

- No transport-first detour. The next useful work is visible governed editing, not iroh/NAT/relay polish.
- No new sync backend. The daemon, tube channels, `/blob`, immutable notes, session claims, and recovery routes are the integration surface.
- No "Zed-latency cosplay." Improve the editor's frame budget enough to be honest and comfortable; win on governance, salvage, capability, and operator control.
- No parallel codebridge beside the old bridge. Integrate, delete, or supersede old bridge/proof paths. #883 should not live beside #896.
- No touching active proof assets from #896/#729/#880 in this doc PR.
- No broad pd-console cull hidden inside editor work. Keep #880's topology decision separate from Beat Zed live-editor wiring.
