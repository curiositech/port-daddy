# Harbor Editor / Beat Zed Current State

Verified live on 2026-07-09 with `gh`, GraphQL mergeability, fetched PR refs,
the current `origin/main` tree, and the `build-coop-ide-gpui` refs 03/04.
This is a current-truth reconciliation doc, not a new architecture pitch.

Reconciled again on 2026-07-23: PR #896 (`perf(pd-console): rescue
virtualized Harbor editor`) merged 2026-07-09 as commit `d3a33a62b`, and
PR #729 (`feat(harbor-editor): wire the in-editor wedge into the LIVE app
(P3 wire stage 1+2)`) merged 2026-07-14 as commit `16ef9dbe3`. Both were
previously tracked below as open branches; they are now on `origin/main`.
PR #883 is CLOSED (not merged, superseded by #896, as this doc already
recommended). PR #880 is still OPEN and unresolved.

This doc intentionally avoids new external platform or competitor claims. Treat
the battle plan's Zed/platform details as historical provenance until someone
refreshes them with live citations.

## 1. Landed Capability Matrix

| Area | Main has now | Only open PR / not landed |
| --- | --- | --- |
| Battle plan | PR #499 merged the Harbor Editor battle plan at `docs/strategy/harbor-editor-battle-plan.md`. | The old "first two weeks" section is historical. Do not treat it as the current next task. |
| P0 - read-only editor surface | PR #563 merged `SurfaceKind::Editor { path, region }`, `EditorPane`, `FileTree -> Editor`, `:edit <path>`, one-pane/two-faces rendering, and visual artifacts. PR #896 (merged 2026-07-09, commit `d3a33a62b`) landed the `Block::CodeBuffer` perf rescue that replaced the `Block::Row` status-card rendering. | Nothing core is missing for P0. |
| P1 - CRDT buffer foundation | Main includes `core/pd-console/src/buffer.rs` with `HarborBuffer`, stable PD-identity-to-`PeerId` mapping, programmatic authored inserts, Loro export/import, snapshot export, and per-line authorship. `editor_pane.rs` renders the Loro-backed buffer and authorship gutter. | Full P1 is not complete: there is still no live GPUI text input element, no human keystrokes into the buffer, no undo-map, and no tree-sitter incremental reparse. |
| P2 - daemon-bus multiplayer substrate | PR #727 merged `editor_sync.rs`, edit-channel frames, presence frames, snapshot refs, op-log note codecs, `/blob` client verbs, `OpLog`, distinct edit vs coordination channels, and `Subscription::Editor { channel, coord_channel }`. PR #729 (merged 2026-07-14, commit `16ef9dbe3`) then wired stage 1+2 of the live app producer/subscription loop onto this substrate. | Verify current stage-1+2 scope directly against `main.rs`/`app.rs` before assuming full live window wiring is complete; this doc does not re-verify wiring depth beyond confirming #729 merged. |
| P3 - agents-as-peers, claims, wedge, commit gate | PR #728 merged `editor_claims.rs`, `editor_wedge.rs`, `editor_commit_gate.rs`, region claims, pre-write conflict-predict request/response plumbing, bypass-free gated messages, staged-region commit gate, and MCP `claim_region` / `release_region`. PR #729 (merged 2026-07-14, commit `16ef9dbe3`) then wired the in-editor wedge into the running GPUI app (stage 1+2). | The visible live-wiring branch that this table previously called "#729 material, not main" is now on main. Confirm any remaining wedge-wiring stages beyond 1+2 by reading the live app directly rather than assuming from this entry. |
| P3.5 - salvage demo | P2 provides the substrate: snapshots to `/blob`, op-log deltas to immutable notes, idempotent replay helpers, and cold-pane hydration tests. | The headline demo is not landed: no end-to-end dead-replica recovery that consumes `/recovery`, inherits a claim, replays the op-log into a live doc, and proves provenance in the visible editor. |
| Editor performance / code rendering | PR #896 (merged 2026-07-09, commit `d3a33a62b`) landed `Block::CodeBuffer`, syntax runs, virtualized `uniform_list`, persistent editor state, and headless raster parity onto main, rescuing the useful #883 work. | #883 is CLOSED (superseded, not merged); treat it as historical mined material only. If code still renders as `Block::Row` cards anywhere, that is a regression against #896, not the expected state. |
| GPUI ecosystem survey | PR #885 merged `docs/design/2026-07-08-gpui-ecosystem-steals.md` and roadmap items. | Use that survey as planning input; do not re-state its external claims from memory. |

## 2. Open Dependency Map

#729 and #896 are no longer open branches — both are MERGED and this
section's prior "do not merge as-is" / "merge first" guidance for them is
resolved. Only #880 remains open:

| PR | Live state | Role | Recommendation |
| --- | --- | --- | --- |
| #729 | MERGED 2026-07-14, commit `16ef9dbe3`, onto `origin/main`. | Wired the in-editor wedge into the running GPUI app (stage 1+2): persistent editor producer, edit/coord channel drains, live wedge Blocks. | Resolved. Any further live-wiring stages beyond 1+2 are a new, unverified scope — check the live app directly rather than treating this row as complete coverage. |
| #896 | MERGED 2026-07-09, commit `d3a33a62b`, onto `origin/main`. | Rescued the virtualized editor, syntax, persistent editor state, shared `CodeBuffer` surface, and headless raster coverage. | Resolved. This is the base the live line is built on. |
| #883 | CLOSED (not merged), superseded by #896 per this doc's prior recommendation. | Original aggressive editor perf rebuild; contained useful ideas later rescued into #896. | Resolved as superseded. Do not revive wholesale. |
| #880 | Still OPEN, non-draft, `mergeable: CONFLICTING` against current main. | Broad pd-console cull and defect PR. It deletes/rewires many panes and mutates `main.rs`, `app.rs`, and `pane.rs`. | Unresolved. Decide/rebase before further live-editor-surface work touches the same files, since #729 already landed changes to `main.rs`/`app.rs` that #880 must now reconcile against. |

Recommended default order (updated):

1. #896 and #729 are both landed; no action needed there.
2. #883 is closed as superseded; no action needed.
3. Resolve #880 against the post-#729 `main.rs`/`app.rs`/`pane.rs`, or park it explicitly.
4. Any further live-editor wiring beyond #729's stage 1+2 is new work — verify current gaps against the live app before scoping it, rather than assuming this doc's pre-merge gap list still applies verbatim.

## 3. What Is Stale In The Old Battle Plan

- P0 is not a future task. It is merged.
- P1 is no longer blank. The CRDT substrate and authorship proof exist, but the live text input element is still missing. Relabel this as "P1 foundation landed; P1 interactive editing remains."
- P2 is not "go build LAN multiplayer from scratch." Main already has daemon-bus transport, presence, snapshot/op-log durability, channel isolation, and (as of merged #729) stage 1+2 of the live app subscription wiring. Relabel as "P2 substrate and stage-1+2 live wiring landed; deeper wiring gaps, if any, are unverified."
- P3 is not "invent claims/wedge/MCP tools." Main already has region claims, pre-write wedge plumbing, commit gate, MCP tools, and (as of merged #729) the in-editor wedge wired into the running GPUI app for stage 1+2. Relabel as "P3 primitives and stage-1+2 operator-visible live wiring landed; remaining wiring depth is unverified here."
- P3.5 remains the real headline wedge. The substrate exists, but the kill-agent/recover-work demo is still unlanded.
- P4/P5 topology work stays behind the wedge. Do not start iroh, remote relay polish, or a new sync backend before the editor can show governed co-editing in the running console.
- The "beat Zed" competitor framing should be treated as historical unless refreshed with live citations. The implementation roadmap does not need new competitor claims.

## 4. Next Landable Implementation PRs

### A. Live Editor Wiring Successor

Status: the branch this section originally described has landed as merged
#729 (commit `16ef9dbe3`), covering wiring stage 1+2. Treat the scope below
as the template for any remaining/next wiring stage, not as still-open work
— verify what, if anything, is left against the live app before re-scoping.

Source material: the merged #729 line, plus the #880 decision.

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
- No touching active proof assets from #880 in this doc PR. (#896 and #729 are merged; their proof assets are now history, not active branch state.)
- No broad pd-console cull hidden inside editor work. Keep #880's topology decision separate from Beat Zed live-editor wiring.
